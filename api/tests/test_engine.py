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


@pytest.mark.parametrize("path", INVALID, ids=lambda path: path.name)
def test_invalid_fixture(path: Path) -> None:
    fixture = _load(path)
    engine = prepare_invalid(fixture)
    assert engine.state() == fixture["expect"]
    with pytest.raises(ScoringError) as caught:
        engine.apply_ball(fixture["illegal"]["event"])
    assert caught.value.code == fixture["expect_error"]
    assert engine.state() == fixture["expect"]
