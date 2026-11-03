"""Load a match into the pure engine and write the log plus snapshot."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine import Ball, Engine
from app.models import BallEventRow, Innings, Match, MatchSnapshot, Player, Team
from app.schemas import CreateMatchRequest, InningsStartIn


@dataclass
class LoadedMatch:
    match: Match
    engine: Engine
    innings_ids: dict[int, uuid.UUID]


def scorecard(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": state["status"],
        "result": state["result"],
        "teams": state["teams"],
        "overs": state["overs"],
        "innings": state["innings"],
    }


def _now() -> datetime:
    return datetime.now(UTC)


async def load_match(
    session: AsyncSession,
    match_id: uuid.UUID,
    *,
    lock: bool,
) -> LoadedMatch | None:
    match = await session.get(Match, match_id, with_for_update=lock)
    if match is None:
        return None
    return await _hydrate(session, match)


async def load_by_slug(session: AsyncSession, slug: str) -> LoadedMatch | None:
    match = await session.scalar(select(Match).where(Match.public_slug == slug))
    if match is None:
        return None
    return await _hydrate(session, match)


async def _hydrate(session: AsyncSession, match: Match) -> LoadedMatch:
    teams = (
        await session.scalars(
            select(Team).where(Team.match_id == match.id).order_by(Team.ordinal)
        )
    ).all()
    players = (
        await session.scalars(
            select(Player).where(Player.match_id == match.id).order_by(Player.ordinal)
        )
    ).all()
    innings_rows = (
        await session.scalars(
            select(Innings).where(Innings.match_id == match.id).order_by(Innings.number)
        )
    ).all()
    ball_rows = (
        await session.scalars(
            select(BallEventRow)
            .where(BallEventRow.match_id == match.id)
            .order_by(BallEventRow.seq)
        )
    ).all()
    players_by_team: dict[str, list[Player]] = {team.id: [] for team in teams}
    for player in players:
        players_by_team.setdefault(player.team_id, []).append(player)
    setup = {
        "overs": match.overs,
        "rules": match.rules_json,
        "teams": [
            {
                "id": team.id,
                "name": team.name,
                "players": [
                    {"id": player.id, "name": player.name}
                    for player in players_by_team.get(team.id, [])
                ],
            }
            for team in teams
        ],
        "toss_winner_team_id": match.toss_winner,
        "toss_decision": match.toss_decision,
    }
    starts = [
        {
            "innings_number": row.number,
            "batting_team_id": row.batting_team_id,
            "bowling_team_id": row.bowling_team_id,
            "striker_id": row.striker_id,
            "non_striker_id": row.non_striker_id,
            "opening_bowler_id": row.opening_bowler_id,
        }
        for row in innings_rows
    ]
    balls = [
        Ball(
            client_uuid=str(row.client_uuid),
            seq=row.seq,
            innings_number=next(
                inn.number for inn in innings_rows if inn.id == row.innings_id
            ),
            striker_id=row.batter_id,
            non_striker_id=row.non_striker_id,
            bowler_id=row.bowler_id,
            runs_bat=row.runs_bat,
            extra_type=row.extra_type,
            extra_runs=row.extra_runs,
            wicket_type=row.wicket_type,
            dismissed_id=row.dismissed_id,
            fielder_id=row.fielder_id,
            over_index=row.over_index,
            ball_in_over=row.ball_in_over,
            voided=row.voided,
        )
        for row in ball_rows
    ]
    return LoadedMatch(
        match=match,
        engine=Engine(setup, starts, balls),
        innings_ids={row.number: row.id for row in innings_rows},
    )


async def insert_match(
    session: AsyncSession,
    body: CreateMatchRequest,
    *,
    slug: str,
    token_hash: str,
) -> tuple[Match, dict[str, Any]]:
    setup = body.model_dump()
    engine = Engine(setup)
    state = engine.state()
    now = _now()
    match = Match(
        id=uuid.uuid4(),
        public_slug=slug,
        team_a_id=body.teams[0].id,
        team_b_id=body.teams[1].id,
        overs=body.overs,
        rules_json=state["rules"],
        toss_winner=body.toss_winner_team_id,
        toss_decision=body.toss_decision,
        status=str(state["status"]),
        scorer_token_hash=token_hash,
        created_at=now,
    )
    session.add(match)
    await session.flush()
    for team_index, team in enumerate(body.teams):
        session.add(
            Team(match_id=match.id, id=team.id, name=team.name, ordinal=team_index)
        )
    await session.flush()
    for team in body.teams:
        for player_index, player in enumerate(team.players):
            session.add(
                Player(
                    match_id=match.id,
                    id=player.id,
                    name=player.name,
                    team_id=team.id,
                    ordinal=player_index,
                )
            )
    session.add(MatchSnapshot(match_id=match.id, state_json=state, updated_at=now))
    await session.flush()
    return match, state


async def insert_innings(
    session: AsyncSession,
    loaded: LoadedMatch,
    body: InningsStartIn,
    state: dict[str, Any],
) -> None:
    target = next(
        innings["target"]
        for innings in state["innings"]
        if innings["innings_number"] == body.innings_number
    )
    session.add(
        Innings(
            id=uuid.uuid4(),
            match_id=loaded.match.id,
            number=body.innings_number,
            batting_team_id=body.batting_team_id,
            bowling_team_id=body.bowling_team_id,
            striker_id=body.striker_id,
            non_striker_id=body.non_striker_id,
            opening_bowler_id=body.opening_bowler_id,
            target=target,
        )
    )
    await save_state(session, loaded.match, state)


async def insert_balls(
    session: AsyncSession,
    loaded: LoadedMatch,
    balls: list[Ball],
    state: dict[str, Any],
) -> None:
    now = _now()
    for ball in balls:
        session.add(
            BallEventRow(
                id=uuid.uuid4(),
                client_uuid=uuid.UUID(ball.client_uuid),
                match_id=loaded.match.id,
                innings_id=loaded.innings_ids[ball.innings_number],
                seq=ball.seq,
                over_index=ball.over_index,
                ball_in_over=ball.ball_in_over,
                batter_id=ball.striker_id,
                non_striker_id=ball.non_striker_id,
                bowler_id=ball.bowler_id,
                runs_bat=ball.runs_bat,
                extra_type=ball.extra_type,
                extra_runs=ball.extra_runs,
                wicket_type=ball.wicket_type,
                dismissed_id=ball.dismissed_id,
                fielder_id=ball.fielder_id,
                created_at=now,
                voided=False,
            )
        )
    await save_state(session, loaded.match, state)


async def void_ball(
    session: AsyncSession,
    loaded: LoadedMatch,
    client_uuid: str,
    state: dict[str, Any],
) -> None:
    row = await session.scalar(
        select(BallEventRow).where(
            BallEventRow.match_id == loaded.match.id,
            BallEventRow.client_uuid == uuid.UUID(client_uuid),
        )
    )
    if row is None:
        from app.errors import ApiError

        raise ApiError("nothing_to_undo")
    row.voided = True
    await save_state(session, loaded.match, state)


async def save_state(session: AsyncSession, match: Match, state: dict[str, Any]) -> None:
    match.status = str(state["status"])
    now = _now()
    snapshot = await session.get(MatchSnapshot, match.id)
    if snapshot is None:
        session.add(MatchSnapshot(match_id=match.id, state_json=state, updated_at=now))
    else:
        snapshot.state_json = state
        snapshot.updated_at = now
    rows = (
        await session.scalars(select(Innings).where(Innings.match_id == match.id))
    ).all()
    by_number = {row.number: row for row in rows}
    for innings in state["innings"]:
        row = by_number.get(int(innings["innings_number"]))
        if row is not None:
            row.target = innings["target"]
