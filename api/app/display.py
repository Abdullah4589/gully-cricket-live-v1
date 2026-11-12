"""Figures the follow page shows. Strike rate and economy are not stored."""

from __future__ import annotations

from typing import Any

from app.engine import round_half_away


def strike_rate(runs: int, balls: int) -> str:
    if balls == 0:
        return "-"
    return str(round_half_away(runs * 100, balls))


def economy(runs: int, legal_balls: int) -> str:
    if legal_balls == 0:
        return "-"
    return str(round_half_away(runs * 6, legal_balls))


def innings_crr(runs: int, overs: int, balls: int) -> str | None:
    legal = overs * 6 + balls
    if legal == 0:
        return None
    return str(round_half_away(runs * 6, legal))


def token_runs(token: str, wide_runs: int, no_ball_runs: int) -> int:
    body = "0" if token == "W" else token[:-1] if token.endswith("W") else token
    if body == "wd":
        return wide_runs
    if body.startswith("wd+"):
        return wide_runs + int(body[3:])
    if body == "nb":
        return no_ball_runs
    if body.startswith("nb+"):
        return no_ball_runs + int(body[3:])
    if body.endswith("lb"):
        return int(body[:-2])
    if body.endswith("b"):
        return int(body[:-1])
    return int(body)


def over_total(tokens: list[str], wide_runs: int, no_ball_runs: int) -> int:
    return sum(token_runs(token, wide_runs, no_ball_runs) for token in tokens)


def toss_line(state: dict[str, Any]) -> str:
    toss = state["toss"]
    winner_id = toss["winner_team_id"]
    name = winner_id
    for team in state["teams"]:
        if team["id"] == winner_id:
            name = team["name"]
            break
    return f"{name} won the toss and chose to {toss['decision']}"


def card_name(innings: dict[str, Any], player_id: str | None) -> str:
    if player_id is None:
        return ""
    for row in [*innings["batting"], *innings["bowling"]]:
        if row["player_id"] == player_id:
            return str(row["name"])
    return player_id


def _batter(innings: dict[str, Any], player_id: str | None) -> dict[str, Any] | None:
    if player_id is None:
        return None
    for row in innings["batting"]:
        if row["player_id"] == player_id:
            found: dict[str, Any] = row
            return found
    return None


def crease_view(state: dict[str, Any]) -> dict[str, Any] | None:
    if not state["innings"] or state["striker_id"] is None:
        return None
    innings = state["innings"][-1]
    striker = _batter(innings, state["striker_id"])
    non_striker = _batter(innings, state["non_striker_id"])
    bowler = None
    for row in innings["bowling"]:
        if row["player_id"] == state["bowler_id"]:
            bowler = row
            break
    if bowler is None:
        bowler_name = state["bowler_id"] or "—"
        figures = "0.0-0-0-0"
        bowler_econ = "-"
    else:
        legal = bowler["overs"]["overs"] * 6 + bowler["overs"]["balls"]
        bowler_name = bowler["name"]
        overs = bowler["overs"]["display"]
        figures = f"{overs}-{bowler['maidens']}-{bowler['runs']}-{bowler['wickets']}"
        bowler_econ = economy(bowler["runs"], legal)
    pair = innings["partnerships"][-1]
    striker_runs = 0 if striker is None else striker["runs"]
    striker_balls = 0 if striker is None else striker["balls"]
    return {
        "striker_name": card_name(innings, state["striker_id"]),
        "striker_score": f"{striker_runs} ({striker_balls})",
        "striker_sr": strike_rate(striker_runs, striker_balls),
        "non_striker_name": None
        if state["non_striker_id"] is None
        else card_name(innings, state["non_striker_id"]),
        "non_striker_score": None
        if non_striker is None
        else f"{non_striker['runs']} ({non_striker['balls']})",
        "non_striker_sr": None
        if non_striker is None
        else strike_rate(non_striker["runs"], non_striker["balls"]),
        "bowler_name": bowler_name,
        "bowler_figures": figures,
        "bowler_econ": bowler_econ,
        "partnership": f"{pair['runs']} ({pair['balls']})",
    }


def partnership_line(innings: dict[str, Any], pair: dict[str, Any]) -> str:
    name = card_name(innings, pair["batter1_id"])
    batters = f"{name} {pair['batter1_runs']} ({pair['batter1_balls']})"
    if pair["batter2_id"] is not None:
        second = card_name(innings, pair["batter2_id"])
        batters += f", {second} {pair['batter2_runs']} ({pair['batter2_balls']})"
    return batters
