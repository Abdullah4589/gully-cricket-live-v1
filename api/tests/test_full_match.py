"""A short chase through the pure engine, then the same balls on the API.

Phone-only gaps (airplane mode, the native share sheet, Maestro, a second
device on the follow link) are outside this process. The outbox queue while
the API is down is covered by mobile/src/sync/flush.test.ts.
"""

from __future__ import annotations

from typing import Any

from app.engine import Engine
from starlette.testclient import TestClient

SETUP: dict[str, Any] = {
    "overs": 1,
    "rules": {"wide_runs": 1, "no_ball_runs": 1, "last_man_stands": False},
    "teams": [
        {
            "id": "N",
            "name": "North End",
            "players": [
                {"id": "n1", "name": "Asha"},
                {"id": "n2", "name": "Bilal"},
            ],
        },
        {
            "id": "H",
            "name": "Harbour Lane",
            "players": [
                {"id": "h1", "name": "Chitra"},
                {"id": "h2", "name": "Dev"},
            ],
        },
    ],
    "toss_winner_team_id": "N",
    "toss_decision": "bat",
}

INNINGS_1: dict[str, Any] = {
    "innings_number": 1,
    "batting_team_id": "N",
    "bowling_team_id": "H",
    "striker_id": "n1",
    "non_striker_id": "n2",
    "opening_bowler_id": "h1",
}

INNINGS_2: dict[str, Any] = {
    "innings_number": 2,
    "batting_team_id": "H",
    "bowling_team_id": "N",
    "striker_id": "h1",
    "non_striker_id": "h2",
    "opening_bowler_id": "n1",
}


def _ball(seq: int, suffix: str, **overrides: Any) -> dict[str, Any]:
    event: dict[str, Any] = {
        "client_uuid": f"00000000-0000-4000-8000-0000000000{suffix}",
        "seq": seq,
        "innings_number": 1,
        "striker_id": "n1",
        "non_striker_id": "n2",
        "bowler_id": "h1",
        "runs_bat": 0,
        "extra_type": None,
        "extra_runs": 0,
        "wicket_type": None,
        "dismissed_id": None,
        "fielder_id": None,
    }
    event.update(overrides)
    return event


WIDE = _ball(1, "01", extra_type="wide")
NO_BALL = _ball(2, "02", extra_type="no_ball")
MISTAKEN_SINGLE = _ball(3, "03", runs_bat=1)
WICKET = _ball(
    4,
    "04",
    wicket_type="bowled",
    dismissed_id="n1",
)
WINNING_FOUR = _ball(
    5,
    "05",
    innings_number=2,
    striker_id="h1",
    non_striker_id="h2",
    bowler_id="n1",
    runs_bat=4,
)


def _play_until_chase_won() -> Engine:
    engine = Engine(SETUP)
    engine.start_innings(INNINGS_1)
    engine.apply_ball(WIDE)
    engine.apply_ball(NO_BALL)
    engine.apply_ball(MISTAKEN_SINGLE)
    engine.undo()
    engine.apply_ball(WICKET)
    engine.start_innings(INNINGS_2)
    engine.apply_ball(WINNING_FOUR)
    return engine


def test_engine_short_chase_wide_noball_wicket_undo() -> None:
    engine = Engine(SETUP)
    engine.start_innings(INNINGS_1)

    engine.apply_ball(WIDE)
    after_wide = engine.state()["innings"][0]
    assert after_wide["runs"] == 1
    assert after_wide["extras"]["wide"] == 1
    assert after_wide["overs"]["display"] == "0.0"
    assert after_wide["overs_timeline"] == [["wd"]]

    engine.apply_ball(NO_BALL)
    after_no_ball = engine.state()["innings"][0]
    assert after_no_ball["runs"] == 2
    assert after_no_ball["extras"]["no_ball"] == 1
    assert after_no_ball["extras"]["total"] == 2
    assert after_no_ball["overs"]["display"] == "0.0"
    assert after_no_ball["overs_timeline"] == [["wd", "nb"]]

    engine.apply_ball(MISTAKEN_SINGLE)
    after_single = engine.state()
    assert after_single["innings"][0]["runs"] == 3
    assert after_single["striker_id"] == "n2"
    assert after_single["non_striker_id"] == "n1"

    voided = engine.undo()
    assert voided == MISTAKEN_SINGLE["client_uuid"]
    restored = engine.state()
    assert restored["innings"][0]["runs"] == 2
    assert restored["innings"][0]["wickets"] == 0
    assert restored["striker_id"] == "n1"
    assert restored["non_striker_id"] == "n2"
    assert restored["innings"][0]["overs_timeline"] == [["wd", "nb"]]

    engine.apply_ball(WICKET)
    broke = engine.state()
    assert broke["status"] == "innings_break"
    first = broke["innings"][0]
    assert first["runs"] == 2
    assert first["wickets"] == 1
    assert first["complete"] is True
    assert first["batting"][0]["dismissal"] == "b Chitra"
    assert first["overs_timeline"] == [["wd", "nb", "W"]]

    engine.start_innings(INNINGS_2)
    engine.apply_ball(WINNING_FOUR)
    won = engine.state()
    assert won["status"] == "complete"
    assert won["result"] == {
        "winner_team_id": "H",
        "margin": 1,
        "margin_unit": "wickets",
    }
    assert won["innings"][0]["runs"] == 2
    assert won["innings"][1]["runs"] == 4
    assert won["innings"][1]["wickets"] == 0
    assert won["innings"][1]["target"] == 3
    assert won["crr"] is None
    assert won["rrr"] is None


def _post_json(
    client: TestClient,
    path: str,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
    status: int = 200,
) -> dict[str, Any]:
    response = client.post(path, json=body, headers=headers)
    assert response.status_code == status, response.text
    parsed: dict[str, Any] = response.json()
    return parsed


def test_api_chase_is_idempotent_and_follow_matches_undo(client: TestClient) -> None:
    created = _post_json(client, "/matches", SETUP, status=201)
    match_id = created["id"]
    slug = created["public_slug"]
    headers = {"Authorization": f"Bearer {created['scorer_token']}"}

    _post_json(client, f"/matches/{match_id}/innings", INNINGS_1, headers)
    for event in (WIDE, NO_BALL, MISTAKEN_SINGLE):
        posted = _post_json(
            client,
            f"/matches/{match_id}/events",
            {"events": [event]},
            headers,
        )
        assert posted["results"] == [
            {"client_uuid": event["client_uuid"], "status": "applied", "seq": event["seq"]}
        ]

    undone = _post_json(client, f"/matches/{match_id}/events/undo", {}, headers)
    assert undone["voided_client_uuid"] == MISTAKEN_SINGLE["client_uuid"]
    assert undone["state"]["innings"][0]["runs"] == 2
    assert undone["state"]["striker_id"] == "n1"

    _post_json(
        client,
        f"/matches/{match_id}/events",
        {"events": [WICKET]},
        headers,
    )
    _post_json(client, f"/matches/{match_id}/innings", INNINGS_2, headers)

    with client.websocket_connect(f"/ws/matches/{slug}") as socket:
        snapshot = socket.receive_json()
        assert snapshot["type"] == "snapshot"
        assert snapshot["state"]["status"] == "innings_2"
        assert snapshot["state"]["innings"][0]["runs"] == 2
        assert snapshot["state"]["innings"][0]["wickets"] == 1
        assert snapshot["state"]["innings"][1]["runs"] == 0
        assert snapshot["state"]["innings"][1]["target"] == 3

        posted = _post_json(
            client,
            f"/matches/{match_id}/events",
            {"events": [WINNING_FOUR]},
            headers,
        )
        assert posted["results"][0]["status"] == "applied"
        ball_frame = socket.receive_json()
        assert ball_frame["type"] == "ball"
        assert ball_frame["event"]["client_uuid"] == WINNING_FOUR["client_uuid"]
        assert ball_frame["state"]["status"] == "complete"
        assert ball_frame["state"]["innings"][1]["runs"] == 4

        retried = _post_json(
            client,
            f"/matches/{match_id}/events",
            {"events": [WINNING_FOUR]},
            headers,
        )
        assert retried["results"] == [
            {
                "client_uuid": WINNING_FOUR["client_uuid"],
                "status": "duplicate",
                "seq": 5,
            }
        ]
        assert retried["state"]["innings"][1]["runs"] == 4

        page = client.get(f"/follow/{slug}")
        assert page.status_code == 200
        assert "text/html" in page.headers["content-type"]
        assert "North End" in page.text
        assert "Harbour Lane" in page.text
        assert "4/0" in page.text
        assert "Harbour Lane won by 1 wicket" in page.text
        assert "Wd 1" in page.text
        assert "Nb 1" in page.text

        expected = _play_until_chase_won().state()
        assert client.get(f"/m/{slug}").json() == expected
        assert ball_frame["state"] == expected

        voided = _play_until_chase_won()
        voided_uuid = voided.undo()
        after_undo = voided.state()

        undone_four = _post_json(client, f"/matches/{match_id}/events/undo", {}, headers)
        assert undone_four["voided_client_uuid"] == voided_uuid
        assert undone_four["voided_client_uuid"] == WINNING_FOUR["client_uuid"]
        assert undone_four["state"] == after_undo

        undo_frame = socket.receive_json()
        assert undo_frame["type"] == "undo"
        assert undo_frame["voided_client_uuid"] == WINNING_FOUR["client_uuid"]
        assert undo_frame["state"] == after_undo

    followed = client.get(f"/follow/{slug}")
    assert followed.status_code == 200
    assert '<p class="score">0/0</p>' in followed.text
    assert "Harbour Lane won by 1 wicket" not in followed.text
    assert "Need 3" in followed.text
    assert client.get(f"/m/{slug}").json() == after_undo
