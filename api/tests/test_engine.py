"""Fixture runner for the shared scoring contract. No database."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.engine import ScoringError, play_valid, prepare_invalid

ROOT = Path(__file__).resolve().parents[2]
VALID = sorted((ROOT / "contracts" / "fixtures" / "valid").glob("*.json"))
INVALID = sorted((ROOT / "contracts" / "fixtures" / "invalid").glob("*.json"))


def _load(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


@pytest.mark.parametrize("path", VALID, ids=lambda path: path.name)
def test_valid_fixture(path: Path) -> None:
    fixture = _load(path)
    assert play_valid(fixture) == fixture["expect"]


@pytest.mark.parametrize("path", VALID, ids=lambda path: path.name)
def test_partnerships_match_the_card(path: Path) -> None:
    state = play_valid(_load(path))
    for innings in state["innings"]:
        pairs = innings["partnerships"]
        pair_runs = sum(pair["runs"] for pair in pairs)
        pair_balls = sum(pair["balls"] for pair in pairs)
        card_balls = sum(row["balls"] for row in innings["batting"])
        assert pair_runs == innings["runs"]
        assert pair_balls == card_balls
        scored: dict[str, int] = {}
        for pair in pairs:
            first = pair["batter1_id"]
            scored[first] = scored.get(first, 0) + pair["batter1_runs"]
            second = pair["batter2_id"]
            if second is not None:
                scored[second] = scored.get(second, 0) + pair["batter2_runs"]
            else:
                assert pair["batter2_runs"] == 0
                assert pair["batter2_balls"] == 0
        for row in innings["batting"]:
            assert scored.get(row["player_id"], 0) == row["runs"]


@pytest.mark.parametrize("path", INVALID, ids=lambda path: path.name)
def test_invalid_fixture(path: Path) -> None:
    fixture = _load(path)
    engine = prepare_invalid(fixture)
    assert engine.state() == fixture["expect"]
    with pytest.raises(ScoringError) as caught:
        engine.apply_ball(fixture["illegal"]["event"])
    assert caught.value.code == fixture["expect_error"]
    assert engine.state() == fixture["expect"]
