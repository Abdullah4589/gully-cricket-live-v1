"""Follow page figures, and the live render after a ball and an undo."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from app.display import economy, over_total, strike_rate
from app.engine import Engine, play_valid
from app.routes.public import templates
from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
VIEW = ROOT / "api" / "app" / "templates" / "follow_view.js"
FIXTURE = ROOT / "contracts" / "fixtures" / "valid" / "partnership-run-out-change.json"


def test_display_rates_and_over_totals() -> None:
    assert strike_rate(10, 3) == "333.33"
    assert strike_rate(4, 0) == "-"
    assert economy(10, 11) == "5.45"
    assert economy(6, 6) == "6"
    assert economy(1, 0) == "-"
    assert over_total(["wd", "4", "1W", "nb+1", "1b", "1lb"], 1, 1) == 10


def test_script_rounds_like_the_engine() -> None:
    rendered = json.loads(
        _node(
            """
            process.stdout.write(JSON.stringify({
              sr: strikeRate(10, 3),
              econ: economy(10, 11),
              whole: economy(6, 6),
              empty: strikeRate(4, 0),
              over: overTotal(
                ["wd", "4", "1W", "nb+1", "1b", "1lb"],
                {wide_runs: 1, no_ball_runs: 1}
              )
            }));
            """
        )
    )
    assert rendered == {"sr": "333.33", "econ": "5.45", "whole": "6", "empty": "-", "over": 10}


def test_script_updates_crease_after_a_ball_and_an_undo() -> None:
    fixture = json.loads(FIXTURE.read_text())
    html = _board(play_valid(fixture))
    assert "A won the toss and chose to bat" in html
    assert "At the crease" in html
    assert "A2" in html and "6 (3)" in html and "SR 200" in html
    assert "A3" in html and "6 (1)" in html and "SR 600" in html
    assert "1.0-0-18-0" in html and "Econ 18" in html
    assert "Partnership" in html and "7 (2)" in html
    assert "Recent overs" in html and "Over 1" in html
    assert 'class="over-total">18' in html
    assert "A1 5 (2), A2 5 (2)" in html and "11 (4)" in html
    assert "A2 1 (1), A3 6 (1)" in html
    assert "CRR 18" in html
    assert "<th>SR</th>" in html and "<th>Econ</th>" in html
    assert ">250</td>" in html

    engine = Engine(fixture["setup"])
    engine.start_innings(fixture["innings"][0])
    for op in fixture["ops"][:-1]:
        engine.apply_ball(op["event"])
    before = _board(engine.state())
    engine.apply_ball(fixture["ops"][-1]["event"])
    after = _board(engine.state())
    engine.undo()
    restored = _board(engine.state())
    assert "SR 600" not in before
    assert "7 (2)" not in before
    assert "SR 600" in after and "7 (2)" in after
    assert "SR 600" not in restored
    assert "7 (2)" not in restored


def test_jinja_page_matches_the_partnership_fixture() -> None:
    fixture = json.loads(FIXTURE.read_text())
    template = templates.env.get_template("follow.html")
    html = template.render(state=play_valid(fixture), slug="demo-slug")
    assert "A won the toss and chose to bat" in html
    assert "At the crease" in html
    assert "6 (3)" in html and "SR 200" in html
    assert "1.0-0-18-0" in html and "Econ 18" in html
    assert "7 (2)" in html
    assert "Recent overs" in html and "Over 1" in html
    assert "A1 5 (2), A2 5 (2)" in html
    assert "CRR 18" in html
    assert "<th>SR</th>" in html and "<th>Econ</th>" in html
    assert "render(frame.state)" in html


def test_posted_match_shows_the_page_and_live_frames(client: TestClient) -> None:
    created = client.post("/matches", json=_payload())
    assert created.status_code == 201
    body = created.json()
    match_id = body["id"]
    slug = body["public_slug"]
    headers = {"Authorization": f"Bearer {body['scorer_token']}"}
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
    four = _ball(1, 4, "n1", "n2")
    posted = client.post(f"/matches/{match_id}/events", headers=headers, json={"events": [four]})
    assert posted.status_code == 200

    page = client.get(f"/follow/{slug}")
    assert page.status_code == 200
    text = page.text
    assert "North End won the toss and chose to bat" in text
    assert "At the crease" in text
    assert "Asha" in text and "4 (1)" in text and "SR 400" in text
    assert "Bilal" in text and "0 (0)" in text and "SR -" in text
    assert "Chitra" in text and "0.1-0-4-0" in text and "Econ 24" in text
    assert "Partnership" in text
    assert "Recent overs" in text and "Over 1" in text
    assert "Asha 4 (1), Bilal 0 (0)" in text
    assert "CRR 24" in text
    assert "<th>SR</th>" in text and "<th>Econ</th>" in text
    assert "render(frame.state)" in text

    single = _ball(2, 1, "n1", "n2")
    with client.websocket_connect(f"/ws/matches/{slug}") as socket:
        snapshot = socket.receive_json()
        assert snapshot["type"] == "snapshot"
        assert snapshot["state"]["crr"] == 24
        assert snapshot["state"]["innings"][0]["partnerships"][0]["runs"] == 4
        assert snapshot["state"]["innings"][0]["overs_timeline"] == [["4"]]

        again = client.post(
            f"/matches/{match_id}/events",
            headers=headers,
            json={"events": [single]},
        )
        assert again.status_code == 200
        ball_frame = socket.receive_json()
        assert ball_frame["type"] == "ball"
        painted = _board(ball_frame["state"])
        assert "5 (2)" in painted and "SR 250" in painted and "CRR 15" in painted
        assert ball_frame["state"]["striker_id"] == "n2"
        assert ball_frame["state"]["innings"][0]["overs_timeline"] == [["4", "1"]]

        undone = client.post(f"/matches/{match_id}/events/undo", headers=headers)
        assert undone.status_code == 200
        undo_frame = socket.receive_json()
        assert undo_frame["type"] == "undo"
        assert undo_frame["voided_client_uuid"] == single["client_uuid"]
        restored = _board(undo_frame["state"])
        assert "5 (2)" not in restored
        assert "4 (1)" in restored and "CRR 24" in restored and "SR 400" in restored
        assert undo_frame["state"]["striker_id"] == "n1"

    followed = client.get(f"/follow/{slug}")
    assert "4 (1)" in followed.text and "SR 400" in followed.text
    assert "5 (2)" not in followed.text
    assert "CRR 15" not in followed.text


def _payload() -> dict[str, Any]:
    return {
        "overs": 2,
        "teams": [
            {
                "id": "N",
                "name": "North End",
                "players": [
                    {"id": "n1", "name": "Asha"},
                    {"id": "n2", "name": "Bilal"},
                    {"id": "n3", "name": "Esha"},
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


def _ball(seq: int, runs: int, striker: str, non_striker: str) -> dict[str, Any]:
    return {
        "client_uuid": f"00000000-0000-4000-8000-0000000000b{seq}",
        "seq": seq,
        "innings_number": 1,
        "striker_id": striker,
        "non_striker_id": non_striker,
        "bowler_id": "h1",
        "runs_bat": runs,
        "extra_type": None,
        "extra_runs": 0,
        "wicket_type": None,
        "dismissed_id": None,
        "fielder_id": None,
    }


def _board(state: dict[str, Any]) -> str:
    tail = """
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => { process.stdout.write(boardHtml(JSON.parse(raw))); });
    """
    return _node(tail, state)


def _node(tail: str, state: dict[str, Any] | None = None) -> str:
    completed = subprocess.run(
        ["node", "-e", VIEW.read_text() + "\n" + tail],
        input=None if state is None else json.dumps(state),
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout
