"""Request bodies. Shapes follow contracts/openapi.yaml."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlayerInput(_Strict):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class TeamInput(_Strict):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    players: list[PlayerInput] = Field(min_length=2)


class RulesInput(_Strict):
    wide_runs: int = Field(default=1, ge=1)
    no_ball_runs: int = Field(default=1, ge=1)
    last_man_stands: bool = True


class CreateMatchRequest(_Strict):
    overs: int = Field(ge=1)
    rules: RulesInput = Field(default_factory=RulesInput)
    teams: list[TeamInput] = Field(min_length=2, max_length=2)
    toss_winner_team_id: str = Field(min_length=1)
    toss_decision: Literal["bat", "bowl"]


class InningsStartIn(_Strict):
    innings_number: Literal[1, 2]
    batting_team_id: str = Field(min_length=1)
    bowling_team_id: str = Field(min_length=1)
    striker_id: str = Field(min_length=1)
    non_striker_id: str = Field(min_length=1)
    opening_bowler_id: str = Field(min_length=1)


class BallEventIn(_Strict):
    client_uuid: str = Field(pattern=_UUID)
    seq: int = Field(ge=1)
    innings_number: Literal[1, 2]
    striker_id: str = Field(min_length=1)
    non_striker_id: Annotated[str, Field(min_length=1)] | None
    bowler_id: str = Field(min_length=1)
    runs_bat: int = Field(ge=0, le=6)
    extra_type: Literal["wide", "no_ball", "bye", "leg_bye"] | None
    extra_runs: int = Field(ge=0)
    wicket_type: Literal["bowled", "caught", "run_out", "stumped", "lbw", "hit_wicket"] | None
    dismissed_id: Annotated[str, Field(min_length=1)] | None
    fielder_id: Annotated[str, Field(min_length=1)] | None
    over_index: Annotated[int, Field(ge=0)] | None = None
    ball_in_over: Annotated[int, Field(ge=1, le=6)] | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_hints(cls, data: object) -> object:
        if isinstance(data, dict):
            for key in ("over_index", "ball_in_over"):
                if key in data and data[key] is None:
                    raise ValueError(f"{key} cannot be null")
        return data


class EventBatch(_Strict):
    events: list[BallEventIn] = Field(min_length=1)
