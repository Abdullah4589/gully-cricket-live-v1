"""Tables for one match. The ball log is the source of truth."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    public_slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    team_a_id: Mapped[str] = mapped_column(Text, nullable=False)
    team_b_id: Mapped[str] = mapped_column(Text, nullable=False)
    overs: Mapped[int] = mapped_column(Integer, nullable=False)
    rules_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    toss_winner: Mapped[str] = mapped_column(Text, nullable=False)
    toss_decision: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    scorer_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Team(Base):
    __tablename__ = "teams"

    match_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("matches.id"), primary_key=True)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)


class Player(Base):
    __tablename__ = "players"

    match_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    team_id: Mapped[str] = mapped_column(Text, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(["match_id"], ["matches.id"]),
        ForeignKeyConstraint(["match_id", "team_id"], ["teams.match_id", "teams.id"]),
    )


class Innings(Base):
    __tablename__ = "innings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    match_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("matches.id"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    batting_team_id: Mapped[str] = mapped_column(Text, nullable=False)
    bowling_team_id: Mapped[str] = mapped_column(Text, nullable=False)
    striker_id: Mapped[str] = mapped_column(Text, nullable=False)
    non_striker_id: Mapped[str] = mapped_column(Text, nullable=False)
    opening_bowler_id: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("match_id", "number"),)


class BallEventRow(Base):
    __tablename__ = "ball_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    client_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    match_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("matches.id"), nullable=False)
    innings_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("innings.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    over_index: Mapped[int] = mapped_column(Integer, nullable=False)
    ball_in_over: Mapped[int] = mapped_column(Integer, nullable=False)
    batter_id: Mapped[str] = mapped_column(Text, nullable=False)
    non_striker_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    bowler_id: Mapped[str] = mapped_column(Text, nullable=False)
    runs_bat: Mapped[int] = mapped_column(Integer, nullable=False)
    extra_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_runs: Mapped[int] = mapped_column(Integer, nullable=False)
    wicket_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    dismissed_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    fielder_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    voided: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("match_id", "seq"),)


class MatchSnapshot(Base):
    __tablename__ = "match_snapshots"

    match_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("matches.id"), primary_key=True
    )
    state_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
