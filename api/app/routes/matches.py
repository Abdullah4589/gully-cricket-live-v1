"""Scorer routes. The bearer token is the only credential."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import bearer_token, hash_token, new_slug, new_token, tokens_match
from app.broadcast import BroadcastHub
from app.engine import ScoringError
from app.errors import ApiError
from app.persist import (
    insert_balls,
    insert_innings,
    insert_match,
    load_match,
    scorecard,
    void_ball,
)
from app.schemas import CreateMatchRequest, EventBatch, InningsStartIn

router = APIRouter()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    maker = request.app.state.sessionmaker
    async with maker() as session:
        yield session


def _parse_match_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise ApiError("not_found") from exc


def _require_token(header: str | None, stored_hash: str) -> None:
    if header is None:
        raise ApiError("unauthorized")
    if not tokens_match(bearer_token(header), stored_hash):
        raise ApiError("unauthorized")


def _state_response(state: dict[str, Any], status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content=state)


@router.post("/matches")
async def create_match(
    body: CreateMatchRequest,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    team_ids = [team.id for team in body.teams]
    player_ids = [player.id for team in body.teams for player in team.players]
    if len(set(team_ids)) != len(team_ids) or len(set(player_ids)) != len(player_ids):
        raise ApiError("id_conflict")
    if body.toss_winner_team_id not in team_ids:
        raise ApiError("invalid_request")
    token = new_token()
    slug = new_slug()
    async with session.begin():
        match, state = await insert_match(
            session,
            body,
            slug=slug,
            token_hash=hash_token(token),
        )
        match_id = str(match.id)
        public_slug = match.public_slug
    return JSONResponse(
        status_code=201,
        content={
            "id": match_id,
            "public_slug": public_slug,
            "scorer_token": token,
            "state": state,
        },
    )


@router.get("/matches/{match_id}")
async def get_match(
    match_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    async with session.begin():
        loaded = await load_match(session, _parse_match_id(match_id), lock=False)
        if loaded is None:
            raise ApiError("not_found")
        _require_token(request.headers.get("authorization"), loaded.match.scorer_token_hash)
        state = loaded.engine.state()
    return _state_response(state)


@router.post("/matches/{match_id}/innings")
async def start_innings(
    match_id: str,
    body: InningsStartIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    async with session.begin():
        loaded = await load_match(session, _parse_match_id(match_id), lock=True)
        if loaded is None:
            raise ApiError("not_found")
        _require_token(request.headers.get("authorization"), loaded.match.scorer_token_hash)
        try:
            state = loaded.engine.start_innings(body.model_dump())
        except ScoringError as exc:
            raise ApiError(exc.code) from exc
        await insert_innings(session, loaded, body, state)
    return _state_response(state)


@router.post("/matches/{match_id}/events")
async def post_events(
    match_id: str,
    body: EventBatch,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    try:
        async with session.begin():
            loaded = await load_match(session, _parse_match_id(match_id), lock=True)
            if loaded is None:
                raise ApiError("not_found")
            _require_token(request.headers.get("authorization"), loaded.match.scorer_token_hash)
            events = [event.model_dump() for event in body.events]
            try:
                outcome = loaded.engine.apply_batch(events)
            except ScoringError as exc:
                raise ApiError(exc.code) from exc
            await insert_balls(session, loaded, outcome.new_balls, outcome.state)
            slug = loaded.match.public_slug
            frames = outcome.frames
            payload = {"results": outcome.results, "state": outcome.state}
    except IntegrityError as exc:
        raise ApiError("uuid_conflict") from exc
    hub: BroadcastHub = request.app.state.hub
    for frame in frames:
        await hub.publish(slug, frame)
    return JSONResponse(content=payload)


@router.post("/matches/{match_id}/events/undo")
async def undo_last_event(
    match_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    async with session.begin():
        loaded = await load_match(session, _parse_match_id(match_id), lock=True)
        if loaded is None:
            raise ApiError("not_found")
        _require_token(request.headers.get("authorization"), loaded.match.scorer_token_hash)
        try:
            voided = loaded.engine.undo()
        except ScoringError as exc:
            raise ApiError(exc.code) from exc
        state = loaded.engine.state()
        await void_ball(session, loaded, voided, state)
        slug = loaded.match.public_slug
    hub: BroadcastHub = request.app.state.hub
    await hub.publish(slug, {"type": "undo", "voided_client_uuid": voided, "state": state})
    return JSONResponse(content={"voided_client_uuid": voided, "state": state})


@router.get("/matches/{match_id}/scorecard")
async def get_scorecard(
    match_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    async with session.begin():
        loaded = await load_match(session, _parse_match_id(match_id), lock=False)
        if loaded is None:
            raise ApiError("not_found")
        header = request.headers.get("authorization")
        if header is not None and not tokens_match(
            bearer_token(header), loaded.match.scorer_token_hash
        ):
            raise ApiError("unauthorized")
        body = scorecard(loaded.engine.state())
    return JSONResponse(content=body, headers={"Cache-Control": "no-store"})
