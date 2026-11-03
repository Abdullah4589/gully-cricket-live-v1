"""Initial scoring tables.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "matches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("public_slug", sa.String(length=64), nullable=False),
        sa.Column("team_a_id", sa.Text(), nullable=False),
        sa.Column("team_b_id", sa.Text(), nullable=False),
        sa.Column("overs", sa.Integer(), nullable=False),
        sa.Column("rules_json", sa.JSON(), nullable=False),
        sa.Column("toss_winner", sa.Text(), nullable=False),
        sa.Column("toss_decision", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("scorer_token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("public_slug"),
    )
    op.create_table(
        "teams",
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.PrimaryKeyConstraint("match_id", "id"),
    )
    op.create_table(
        "players",
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("team_id", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.ForeignKeyConstraint(["match_id", "team_id"], ["teams.match_id", "teams.id"]),
        sa.PrimaryKeyConstraint("match_id", "id"),
    )
    op.create_table(
        "innings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("batting_team_id", sa.Text(), nullable=False),
        sa.Column("bowling_team_id", sa.Text(), nullable=False),
        sa.Column("striker_id", sa.Text(), nullable=False),
        sa.Column("non_striker_id", sa.Text(), nullable=False),
        sa.Column("opening_bowler_id", sa.Text(), nullable=False),
        sa.Column("target", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.UniqueConstraint("match_id", "number"),
    )
    op.create_table(
        "ball_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("client_uuid", sa.Uuid(), nullable=False),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("innings_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("over_index", sa.Integer(), nullable=False),
        sa.Column("ball_in_over", sa.Integer(), nullable=False),
        sa.Column("batter_id", sa.Text(), nullable=False),
        sa.Column("non_striker_id", sa.Text(), nullable=True),
        sa.Column("bowler_id", sa.Text(), nullable=False),
        sa.Column("runs_bat", sa.Integer(), nullable=False),
        sa.Column("extra_type", sa.Text(), nullable=True),
        sa.Column("extra_runs", sa.Integer(), nullable=False),
        sa.Column("wicket_type", sa.Text(), nullable=True),
        sa.Column("dismissed_id", sa.Text(), nullable=True),
        sa.Column("fielder_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["innings_id"], ["innings.id"]),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.UniqueConstraint("client_uuid"),
        sa.UniqueConstraint("match_id", "seq"),
    )
    op.create_table(
        "match_snapshots",
        sa.Column("match_id", sa.Uuid(), primary_key=True),
        sa.Column("state_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
    )


def downgrade() -> None:
    op.drop_table("match_snapshots")
    op.drop_table("ball_events")
    op.drop_table("innings")
    op.drop_table("players")
    op.drop_table("teams")
    op.drop_table("matches")
