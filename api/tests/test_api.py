"""HTTP and websocket checks against Postgres."""

from __future__ import annotations

import httpx
from starlette.testclient import TestClient


def _payload() -> dict[str, object]:
    return {
        "overs": 2,
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


def _ball(client_uuid: str, seq: int, runs: int) -> dict[str, object]:
    return {
        "client_uuid": client_uuid,
        "seq": seq,
        "innings_number": 1,
        "striker_id": "n1",
        "non_striker_id": "n2",
        "bowler_id": "h1",
        "runs_bat": runs,
        "extra_type": None,
        "extra_runs": 0,
        "wicket_type": None,
        "dismissed_id": None,
        "fielder_id": None,
    }


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert isinstance(client, httpx.Client)


def test_scoring_flow(client: TestClient) -> None:
    created = client.post("/matches", json=_payload())
    assert created.status_code == 201
    body = created.json()
    match_id = body["id"]
    token = body["scorer_token"]
    slug = body["public_slug"]
    assert len(token) >= 22
    assert body["state"]["status"] == "not_started"
    headers = {"Authorization": f"Bearer {token}"}

    missing = client.get(f"/matches/{match_id}")
    assert missing.status_code == 401
    assert missing.json() == {"error": "unauthorized"}

    wrong = client.get(
        f"/matches/{match_id}",
        headers={"Authorization": "Bearer not-the-scorer-token"},
    )
    assert wrong.status_code == 401
    assert wrong.json() == {"error": "unauthorized"}

    started = client.post(
        f"/matches/{match_id}/innings",
        headers=headers,
        json={
            "innings_number": 1,
            "batting_team_id": "N",
            "bowling_team_id": "H",
            "striker_id": "n1",
            "non_striker_id": "n2",
            "opening_bowler_id": "h1",
        },
    )
    assert started.status_code == 200
    assert started.json()["status"] == "innings_1"

    ball_id = "00000000-0000-4000-8000-0000000000a1"
    posted = client.post(
        f"/matches/{match_id}/events",
        headers=headers,
        json={"events": [_ball(ball_id, 1, 4)]},
    )
    assert posted.status_code == 200
    posted_body = posted.json()
    assert posted_body["results"] == [{"client_uuid": ball_id, "status": "applied", "seq": 1}]
    assert posted_body["state"]["innings"][0]["runs"] == 4

    duplicate = client.post(
        f"/matches/{match_id}/events",
        headers=headers,
        json={"events": [_ball(ball_id, 1, 4)]},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["results"][0]["status"] == "duplicate"
    assert duplicate.json()["state"]["innings"][0]["runs"] == 4

    conflict = client.post(
        f"/matches/{match_id}/events",
        headers=headers,
        json={
            "events": [
                _ball(ball_id, 1, 1),
                _ball("00000000-0000-4000-8000-0000000000a2", 2, 1),
            ]
        },
    )
    assert conflict.status_code == 409
    assert conflict.json() == {"error": "uuid_conflict"}

    public = client.get(f"/m/{slug}")
    assert public.status_code == 200
    assert public.json()["innings"][0]["runs"] == 4

    undone = client.post(f"/matches/{match_id}/events/undo", headers=headers)
    assert undone.status_code == 200
    assert undone.json()["voided_client_uuid"] == ball_id
    assert undone.json()["state"]["innings"][0]["runs"] == 0

    again = client.post(f"/matches/{match_id}/events/undo", headers=headers)
    assert again.status_code == 409
    assert again.json() == {"error": "nothing_to_undo"}

    gap = client.post(
        f"/matches/{match_id}/events",
        headers=headers,
        json={"events": [_ball("00000000-0000-4000-8000-0000000000a3", 1, 1)]},
    )
    assert gap.status_code == 422
    assert gap.json() == {"error": "seq_gap"}
    assert client.get(f"/m/{slug}").json()["innings"][0]["runs"] == 0

    open_card = client.get(f"/matches/{match_id}/scorecard")
    assert open_card.status_code == 200
    assert open_card.json()["teams"][0]["name"] == "North End"
    public_card = client.get(f"/m/{slug}/scorecard")
    assert public_card.status_code == 200
    assert public_card.json()["toss"] == {"winner_team_id": "N", "decision": "bat"}
    bad_card = client.get(
        f"/matches/{match_id}/scorecard",
        headers={"Authorization": "Bearer not-the-scorer-token"},
    )
    assert bad_card.status_code == 401
    assert bad_card.json() == {"error": "unauthorized"}

    page = client.get(f"/follow/{slug}")
    assert page.status_code == 200
    assert "text/html" in page.headers["content-type"]
    assert "North End" in page.text
    assert "Harbour Lane" in page.text

    with client.websocket_connect(f"/ws/matches/{slug}") as socket:
        frame = socket.receive_json()
    assert frame["type"] == "snapshot"
    assert frame["state"]["teams"][0]["name"] == "North End"
    assert frame["state"]["innings"][0]["runs"] == 0
