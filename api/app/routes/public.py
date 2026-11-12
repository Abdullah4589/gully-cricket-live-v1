"""Public read routes and the follow page. No login."""

from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse
from starlette.templating import Jinja2Templates
from starlette.websockets import WebSocketDisconnect

from app.auth import SLUG_RE
from app.broadcast import BroadcastHub, Subscription
from app.display import (
    crease_view,
    economy,
    innings_crr,
    over_total,
    partnership_line,
    strike_rate,
    toss_line,
)
from app.errors import ApiError
from app.persist import load_by_slug, scorecard

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))
templates.env.globals.update(
    crease_view=crease_view,
    economy=economy,
    innings_crr=innings_crr,
    over_total=over_total,
    partnership_line=partnership_line,
    strike_rate=strike_rate,
    toss_line=toss_line,
)


@router.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"ok": True})


@router.get("/m/{slug}")
async def get_public_match(slug: str, request: Request) -> JSONResponse:
    state = await _public_state(request, slug)
    return JSONResponse(content=state, headers={"Cache-Control": "no-store"})


@router.get("/m/{slug}/scorecard")
async def get_public_scorecard(slug: str, request: Request) -> JSONResponse:
    state = await _public_state(request, slug)
    return JSONResponse(content=scorecard(state), headers={"Cache-Control": "no-store"})


@router.get("/follow/{slug}")
async def follow_page(slug: str, request: Request) -> object:
    state = await _public_state(request, slug)
    return templates.TemplateResponse(
        request,
        "follow.html",
        {"state": state, "slug": slug},
        headers={"Cache-Control": "no-store"},
    )


@router.websocket("/ws/matches/{slug}")
async def match_socket(websocket: WebSocket, slug: str) -> None:
    await websocket.accept()
    if SLUG_RE.fullmatch(slug) is None:
        await websocket.close(code=1008)
        return
    hub: BroadcastHub = websocket.app.state.hub
    subscription = await hub.subscribe(slug)
    try:
        maker = websocket.app.state.sessionmaker
        async with maker() as session:
            loaded = await load_by_slug(session, slug)
            if loaded is None:
                await websocket.close(code=1008)
                return
            state = loaded.engine.state()
        await websocket.send_json({"type": "snapshot", "state": state})
        await _pump(websocket, subscription)
    finally:
        await subscription.aclose()


async def _public_state(request: Request, slug: str) -> dict[str, object]:
    if SLUG_RE.fullmatch(slug) is None:
        raise ApiError("not_found")
    maker = request.app.state.sessionmaker
    async with maker() as session:
        loaded = await load_by_slug(session, slug)
        if loaded is None:
            raise ApiError("not_found")
        return loaded.engine.state()


async def _pump(websocket: WebSocket, subscription: Subscription) -> None:
    incoming: asyncio.Task[None] = asyncio.create_task(_watch_client(websocket))
    frames: asyncio.Task[dict[str, object]] = asyncio.create_task(subscription.get())
    try:
        while True:
            done, _pending = await asyncio.wait(
                {incoming, frames},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if incoming in done:
                incoming.result()
                return
            await websocket.send_json(frames.result())
            frames = asyncio.create_task(subscription.get())
    except WebSocketDisconnect:
        return
    finally:
        incoming.cancel()
        frames.cancel()
        for task in (incoming, frames):
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect):
                await task


async def _watch_client(websocket: WebSocket) -> None:
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            code = message.get("code", 1000)
            raise WebSocketDisconnect(code if isinstance(code, int) else 1000)
