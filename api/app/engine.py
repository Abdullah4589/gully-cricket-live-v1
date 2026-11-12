"""Pure scoring engine. No database imports.

Replay the non-voided ball log from a fresh match after every accepted ball
and after every undo. Stored totals are never the source of truth.
"""

from __future__ import annotations

import copy
import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

_BOWLER_WICKET = frozenset({"bowled", "caught", "stumped", "lbw", "hit_wicket"})
_STRIKER_WICKET = frozenset({"bowled", "lbw", "hit_wicket", "caught", "stumped"})
_FIELDER_WICKET = frozenset({"caught", "stumped", "run_out"})


class ScoringError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Rules:
    wide_runs: int
    no_ball_runs: int
    last_man_stands: bool


@dataclass(frozen=True)
class Player:
    id: str
    name: str


@dataclass(frozen=True)
class Team:
    id: str
    name: str
    players: tuple[Player, ...]


@dataclass
class Ball:
    client_uuid: str
    seq: int
    innings_number: int
    striker_id: str
    non_striker_id: str | None
    bowler_id: str
    runs_bat: int
    extra_type: str | None
    extra_runs: int
    wicket_type: str | None
    dismissed_id: str | None
    fielder_id: str | None
    over_index: int
    ball_in_over: int
    voided: bool = False

    def delivery(self) -> tuple[object, ...]:
        return (
            self.seq,
            self.innings_number,
            self.striker_id,
            self.non_striker_id,
            self.bowler_id,
            self.runs_bat,
            self.extra_type,
            self.extra_runs,
            self.wicket_type,
            self.dismissed_id,
            self.fielder_id,
        )

    def to_event(self) -> dict[str, Any]:
        return {
            "client_uuid": self.client_uuid,
            "seq": self.seq,
            "innings_number": self.innings_number,
            "striker_id": self.striker_id,
            "non_striker_id": self.non_striker_id,
            "bowler_id": self.bowler_id,
            "runs_bat": self.runs_bat,
            "extra_type": self.extra_type,
            "extra_runs": self.extra_runs,
            "wicket_type": self.wicket_type,
            "dismissed_id": self.dismissed_id,
            "fielder_id": self.fielder_id,
            "over_index": self.over_index,
            "ball_in_over": self.ball_in_over,
        }


@dataclass
class ApplyResult:
    status: Literal["applied", "duplicate"]
    seq: int
    ball: Ball | None
    client_uuid: str


@dataclass
class BatchOutcome:
    results: list[dict[str, Any]]
    state: dict[str, Any]
    frames: list[dict[str, Any]]
    new_balls: list[Ball]


@dataclass
class BatterCard:
    player_id: str
    name: str
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    out: bool = False
    dismissal: str = "not out"

    def to_dict(self) -> dict[str, Any]:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "runs": self.runs,
            "balls": self.balls,
            "fours": self.fours,
            "sixes": self.sixes,
            "out": self.out,
            "dismissal": self.dismissal,
        }


@dataclass
class BowlerCard:
    player_id: str
    name: str
    legal: int = 0
    maidens: int = 0
    runs: int = 0
    wickets: int = 0


@dataclass
class Partnership:
    wicket: int
    batter1_id: str
    batter2_id: str | None
    batter1_runs: int = 0
    batter1_balls: int = 0
    batter2_runs: int = 0
    batter2_balls: int = 0
    runs: int = 0
    balls: int = 0
    open: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "wicket": self.wicket,
            "batter1_id": self.batter1_id,
            "batter1_runs": self.batter1_runs,
            "batter1_balls": self.batter1_balls,
            "batter2_id": self.batter2_id,
            "batter2_runs": self.batter2_runs,
            "batter2_balls": self.batter2_balls,
            "runs": self.runs,
            "balls": self.balls,
        }


@dataclass
class InningsState:
    number: int
    batting_team_id: str
    bowling_team_id: str
    opening_bowler_id: str
    target: int | None
    runs: int = 0
    wickets: int = 0
    legal_balls: int = 0
    deliveries: int = 0
    complete: bool = False
    extras_wide: int = 0
    extras_no_ball: int = 0
    extras_bye: int = 0
    extras_leg_bye: int = 0
    batting: list[BatterCard] | None = None
    bowling: list[BowlerCard] | None = None
    fall_of_wickets: list[dict[str, Any]] | None = None
    timeline: list[list[str]] | None = None
    partnerships: list[Partnership] | None = None
    over_just_completed: bool = False
    over_charged: int = 0
    over_legal: dict[str, int] | None = None

    def __post_init__(self) -> None:
        if self.batting is None:
            self.batting = []
        if self.bowling is None:
            self.bowling = []
        if self.fall_of_wickets is None:
            self.fall_of_wickets = []
        if self.timeline is None:
            self.timeline = []
        if self.partnerships is None:
            self.partnerships = []
        if self.over_legal is None:
            self.over_legal = {}

    def batter(self, player_id: str, names: Mapping[str, str]) -> BatterCard:
        assert self.batting is not None
        for row in self.batting:
            if row.player_id == player_id:
                return row
        row = BatterCard(player_id=player_id, name=names[player_id])
        self.batting.append(row)
        return row

    def bowler(self, player_id: str, names: Mapping[str, str]) -> BowlerCard:
        assert self.bowling is not None
        for row in self.bowling:
            if row.player_id == player_id:
                return row
        row = BowlerCard(player_id=player_id, name=names[player_id])
        self.bowling.append(row)
        return row


def resolve_rules(raw: Mapping[str, Any] | None) -> Rules:
    data = dict(raw or {})
    last_man = data["last_man_stands"] if "last_man_stands" in data else True
    return Rules(
        wide_runs=int(data.get("wide_runs", 1)),
        no_ball_runs=int(data.get("no_ball_runs", 1)),
        last_man_stands=bool(last_man),
    )


def round_rate(numerator: int, denominator: int) -> int | float:
    """Round half away from zero to 2 decimal places. Whole numbers stay ints."""
    quantized = (Decimal(numerator) * Decimal(6) / Decimal(denominator)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    if quantized == quantized.to_integral_value():
        return int(quantized)
    return float(json.loads(format(quantized, "f")))


def overs_dict(legal: int) -> dict[str, Any]:
    overs = legal // 6
    balls = legal % 6
    return {"overs": overs, "balls": balls, "display": f"{overs}.{balls}"}


def canonical_uuid(value: object) -> str:
    return str(uuid.UUID(str(value)))


def _event_delivery(event: Mapping[str, Any]) -> tuple[object, ...]:
    return (
        int(event["seq"]),
        int(event["innings_number"]),
        str(event["striker_id"]),
        None if event["non_striker_id"] is None else str(event["non_striker_id"]),
        str(event["bowler_id"]),
        int(event["runs_bat"]),
        event["extra_type"],
        int(event["extra_runs"]),
        event["wicket_type"],
        None if event["dismissed_id"] is None else str(event["dismissed_id"]),
        None if event["fielder_id"] is None else str(event["fielder_id"]),
    )


def _token(ball: Ball) -> str:
    extra = ball.extra_type
    if extra == "wide":
        base = "wd" if ball.extra_runs == 0 else f"wd+{ball.extra_runs}"
    elif extra == "no_ball":
        added = ball.runs_bat + ball.extra_runs
        base = "nb" if added == 0 else f"nb+{added}"
    elif extra == "bye":
        base = f"{ball.extra_runs}b"
    elif extra == "leg_bye":
        base = f"{ball.extra_runs}lb"
    else:
        base = str(ball.runs_bat)
    if ball.wicket_type is None:
        return base
    if base == "0":
        return "W"
    return f"{base}W"


def _dismissal(kind: str, bowler: str, fielder: str | None) -> str:
    if kind == "bowled":
        return f"b {bowler}"
    if kind == "caught":
        return f"c {fielder} b {bowler}"
    if kind == "run_out":
        return f"run out ({fielder})"
    if kind == "stumped":
        return f"st {fielder} b {bowler}"
    if kind == "lbw":
        return f"lbw b {bowler}"
    if kind == "hit_wicket":
        return f"hit wicket b {bowler}"
    raise AssertionError(kind)


def _same_pair(partnership: Partnership, striker_id: str, non_striker_id: str | None) -> bool:
    crease = {striker_id}
    if non_striker_id is not None:
        crease.add(non_striker_id)
    standing = {partnership.batter1_id}
    if partnership.batter2_id is not None:
        standing.add(partnership.batter2_id)
    return crease == standing


def _pair_order(
    previous: Partnership | None,
    striker_id: str,
    non_striker_id: str | None,
) -> tuple[str, str | None]:
    if previous is None or non_striker_id is None:
        return striker_id, non_striker_id
    stayed = {previous.batter1_id}
    if previous.batter2_id is not None:
        stayed.add(previous.batter2_id)
    if striker_id in stayed and non_striker_id not in stayed:
        return striker_id, non_striker_id
    if non_striker_id in stayed and striker_id not in stayed:
        return non_striker_id, striker_id
    return striker_id, non_striker_id


def _credit_partnership(
    partnership: Partnership,
    striker_id: str,
    batter_runs: int,
    faced: bool,
    team_runs: int,
) -> None:
    partnership.runs += team_runs
    if faced:
        partnership.balls += 1
    if striker_id == partnership.batter1_id:
        partnership.batter1_runs += batter_runs
        if faced:
            partnership.batter1_balls += 1
        return
    if partnership.batter2_id is not None and striker_id == partnership.batter2_id:
        partnership.batter2_runs += batter_runs
        if faced:
            partnership.batter2_balls += 1


def _accounts(rules: Rules, ball: Ball) -> tuple[int, int, int, int, bool, bool]:
    """Return team runs, batter runs, bowler runs, swap runs, legal, faced."""
    extra = ball.extra_type
    if extra is None:
        return ball.runs_bat, ball.runs_bat, ball.runs_bat, ball.runs_bat, True, True
    if extra == "bye":
        return ball.extra_runs, 0, 0, ball.extra_runs, True, True
    if extra == "leg_bye":
        return ball.extra_runs, 0, 0, ball.extra_runs, True, True
    if extra == "wide":
        team = rules.wide_runs + ball.extra_runs
        return team, 0, team, ball.extra_runs, False, False
    team = rules.no_ball_runs + ball.runs_bat + ball.extra_runs
    return team, ball.runs_bat, team, ball.runs_bat + ball.extra_runs, False, True


class _Sim:
    def __init__(self, engine: Engine) -> None:
        self.rules = engine.rules
        self.teams = engine.teams
        self.scheduled_overs = engine.overs
        self.names = engine.names
        self.squads = engine.squads
        self.status = "not_started"
        self.result: dict[str, Any] | None = None
        self.striker_id: str | None = None
        self.non_striker_id: str | None = None
        self.bowler_id: str | None = None
        self.needs_new_batter: str | None = None
        self.needs_new_bowler = False
        self.innings: list[InningsState] = []
        self.toss_winner = engine.toss_winner
        self.toss_decision = engine.toss_decision

    def innings_by_number(self, number: int) -> InningsState | None:
        for inn in self.innings:
            if inn.number == number:
                return inn
        return None

    def open_innings(self, start: Mapping[str, Any]) -> None:
        number = int(start["innings_number"])
        target: int | None = None
        if number == 2:
            first = self.innings_by_number(1)
            if first is None:
                raise ScoringError("innings_not_ready")
            target = first.runs + 1
        striker = str(start["striker_id"])
        non_striker = str(start["non_striker_id"])
        bowler = str(start["opening_bowler_id"])
        inn = InningsState(
            number=number,
            batting_team_id=str(start["batting_team_id"]),
            bowling_team_id=str(start["bowling_team_id"]),
            opening_bowler_id=bowler,
            target=target,
        )
        inn.batter(striker, self.names)
        inn.batter(non_striker, self.names)
        assert inn.partnerships is not None
        inn.partnerships.append(Partnership(wicket=1, batter1_id=striker, batter2_id=non_striker))
        self.innings.append(inn)
        self.status = "innings_1" if number == 1 else "innings_2"
        self.striker_id = striker
        self.non_striker_id = non_striker
        self.bowler_id = bowler
        self.needs_new_batter = None
        self.needs_new_bowler = False

    def apply(self, ball: Ball) -> None:
        inn = self.innings_by_number(ball.innings_number)
        if inn is None:
            raise ScoringError("innings_not_ready")
        inn.deliveries += 1
        # The event names the crease at the start of this delivery, including a
        # replacement batter chosen after needs_new_batter.
        self.striker_id = ball.striker_id
        self.non_striker_id = ball.non_striker_id
        self.bowler_id = ball.bowler_id
        inn.batter(ball.striker_id, self.names)
        if ball.non_striker_id is not None:
            inn.batter(ball.non_striker_id, self.names)

        team_runs, batter_runs, bowler_runs, swap_runs, legal, faced = _accounts(self.rules, ball)
        partnership = self._partnership_for(inn, ball.striker_id, ball.non_striker_id)
        _credit_partnership(partnership, ball.striker_id, batter_runs, faced, team_runs)
        inn.runs += team_runs
        if ball.extra_type == "wide":
            inn.extras_wide += team_runs
        elif ball.extra_type == "no_ball":
            inn.extras_no_ball += self.rules.no_ball_runs + ball.extra_runs
        elif ball.extra_type == "bye":
            inn.extras_bye += ball.extra_runs
        elif ball.extra_type == "leg_bye":
            inn.extras_leg_bye += ball.extra_runs

        batter = inn.batter(ball.striker_id, self.names)
        batter.runs += batter_runs
        if faced:
            batter.balls += 1
        if ball.runs_bat == 4:
            batter.fours += 1
        if ball.runs_bat == 6:
            batter.sixes += 1

        bowler = inn.bowler(ball.bowler_id, self.names)
        bowler.runs += bowler_runs
        inn.over_charged += bowler_runs
        if legal:
            inn.legal_balls += 1
            bowler.legal += 1
            assert inn.over_legal is not None
            inn.over_legal[ball.bowler_id] = inn.over_legal.get(ball.bowler_id, 0) + 1
        if ball.wicket_type in _BOWLER_WICKET:
            bowler.wickets += 1

        if ball.wicket_type is not None and ball.dismissed_id is not None:
            dismissed = inn.batter(ball.dismissed_id, self.names)
            dismissed.out = True
            dismissed.dismissal = _dismissal(
                ball.wicket_type,
                self.names[ball.bowler_id],
                self.names[ball.fielder_id] if ball.fielder_id is not None else None,
            )
            inn.wickets += 1
            partnership.open = False
            assert inn.fall_of_wickets is not None
            inn.fall_of_wickets.append(
                {"wicket": inn.wickets, "runs": inn.runs, "batter_id": ball.dismissed_id}
            )

        assert inn.timeline is not None
        if not inn.timeline or inn.over_just_completed:
            inn.timeline.append([])
            inn.over_just_completed = False
        inn.timeline[-1].append(_token(ball))
        completed_over = legal and inn.legal_balls % 6 == 0
        if completed_over:
            self._award_maiden(inn)
            inn.over_charged = 0
            inn.over_legal = {}
            inn.over_just_completed = True

        if ball.non_striker_id is not None:
            if ball.wicket_type is None and swap_runs % 2 == 1:
                self._swap()
            if completed_over:
                self._swap()

        ended = self._should_end(inn)
        if ended:
            inn.complete = True
            self.needs_new_batter = None
            self.needs_new_bowler = False
            if inn.number == 1:
                self.status = "innings_break"
                self.result = None
            else:
                self.status = "complete"
                self.result = self._result(inn)
            return

        if ball.wicket_type is not None:
            if ball.dismissed_id == self.striker_id:
                self.needs_new_batter = "striker"
            else:
                self.needs_new_batter = "non_striker"
        else:
            self.needs_new_batter = None
        self.needs_new_bowler = completed_over

    def _swap(self) -> None:
        if self.non_striker_id is None:
            return
        self.striker_id, self.non_striker_id = self.non_striker_id, self.striker_id

    def _award_maiden(self, inn: InningsState) -> None:
        assert inn.over_legal is not None
        if inn.over_charged != 0:
            return
        full = [bowler_id for bowler_id, count in inn.over_legal.items() if count == 6]
        if len(full) != 1:
            return
        inn.bowler(full[0], self.names).maidens += 1

    def _should_end(self, inn: InningsState) -> bool:
        if inn.legal_balls >= self.scheduled_overs * 6:
            return True
        squad = len(self.squads[inn.batting_team_id])
        threshold = squad if self.rules.last_man_stands else squad - 1
        if inn.wickets >= threshold:
            return True
        return bool(inn.number == 2 and inn.target is not None and inn.runs >= inn.target)

    def _result(self, inn: InningsState) -> dict[str, Any]:
        assert inn.target is not None
        squad = len(self.squads[inn.batting_team_id])
        if inn.runs >= inn.target:
            threshold = squad if self.rules.last_man_stands else squad - 1
            return {
                "winner_team_id": inn.batting_team_id,
                "margin": threshold - inn.wickets,
                "margin_unit": "wickets",
            }
        if inn.runs == inn.target - 1:
            return {"tie": True}
        return {
            "winner_team_id": inn.bowling_team_id,
            "margin": inn.target - 1 - inn.runs,
            "margin_unit": "runs",
        }

    def to_state(self) -> dict[str, Any]:
        crr, rrr, runs_needed = self._rates()
        return {
            "status": self.status,
            "result": self.result,
            "overs": self.scheduled_overs,
            "rules": {
                "wide_runs": self.rules.wide_runs,
                "no_ball_runs": self.rules.no_ball_runs,
                "last_man_stands": self.rules.last_man_stands,
            },
            "teams": [{"id": team.id, "name": team.name} for team in self.teams],
            "innings": [self._innings_dict(inn) for inn in self.innings],
            "striker_id": self.striker_id,
            "non_striker_id": self.non_striker_id,
            "bowler_id": self.bowler_id,
            "needs_new_batter": self.needs_new_batter,
            "needs_new_bowler": self.needs_new_bowler,
            "crr": crr,
            "rrr": rrr,
            "runs_needed": runs_needed,
            "toss": {"winner_team_id": self.toss_winner, "decision": self.toss_decision},
        }

    def _innings_dict(self, inn: InningsState) -> dict[str, Any]:
        assert inn.batting is not None
        assert inn.bowling is not None
        assert inn.fall_of_wickets is not None
        assert inn.timeline is not None
        assert inn.partnerships is not None
        total = inn.extras_wide + inn.extras_no_ball + inn.extras_bye + inn.extras_leg_bye
        return {
            "innings_number": inn.number,
            "batting_team_id": inn.batting_team_id,
            "bowling_team_id": inn.bowling_team_id,
            "runs": inn.runs,
            "wickets": inn.wickets,
            "overs": overs_dict(inn.legal_balls),
            "target": inn.target,
            "complete": inn.complete,
            "extras": {
                "wide": inn.extras_wide,
                "no_ball": inn.extras_no_ball,
                "bye": inn.extras_bye,
                "leg_bye": inn.extras_leg_bye,
                "total": total,
            },
            "batting": [row.to_dict() for row in inn.batting],
            "bowling": [
                {
                    "player_id": row.player_id,
                    "name": row.name,
                    "overs": overs_dict(row.legal),
                    "maidens": row.maidens,
                    "runs": row.runs,
                    "wickets": row.wickets,
                }
                for row in inn.bowling
            ],
            "fall_of_wickets": [dict(item) for item in inn.fall_of_wickets],
            "overs_timeline": [list(over) for over in inn.timeline],
            "partnerships": [row.to_dict() for row in inn.partnerships],
        }

    def _rates(self) -> tuple[int | float | None, int | float | None, int | None]:
        if self.status in ("innings_1", "innings_break"):
            inn = self.innings_by_number(1)
            if inn is None or inn.legal_balls == 0:
                return None, None, None
            return round_rate(inn.runs, inn.legal_balls), None, None
        if self.status != "innings_2":
            return None, None, None
        inn = self.innings_by_number(2)
        if inn is None or inn.target is None:
            return None, None, None
        runs_needed = max(inn.target - inn.runs, 0)
        balls_left = self.scheduled_overs * 6 - inn.legal_balls
        crr = round_rate(inn.runs, inn.legal_balls) if inn.legal_balls else None
        rrr = round_rate(runs_needed, balls_left) if balls_left else None
        return crr, rrr, runs_needed

    def _partnership_for(
        self,
        inn: InningsState,
        striker_id: str,
        non_striker_id: str | None,
    ) -> Partnership:
        assert inn.partnerships is not None
        current = inn.partnerships[-1] if inn.partnerships else None
        if current is not None and current.open and _same_pair(current, striker_id, non_striker_id):
            return current
        if current is not None and current.open:
            current.open = False
        batter1, batter2 = _pair_order(current, striker_id, non_striker_id)
        opened = Partnership(wicket=inn.wickets + 1, batter1_id=batter1, batter2_id=batter2)
        inn.partnerships.append(opened)
        return opened


class Engine:
    def __init__(
        self,
        setup: Mapping[str, Any],
        innings: Sequence[Mapping[str, Any]] | None = None,
        balls: Sequence[Ball] | None = None,
    ) -> None:
        self.overs = int(setup["overs"])
        self.rules = resolve_rules(setup.get("rules"))
        teams: list[Team] = []
        for raw_team in setup["teams"]:
            players = tuple(
                Player(id=str(player["id"]), name=str(player["name"]))
                for player in raw_team["players"]
            )
            teams.append(Team(id=str(raw_team["id"]), name=str(raw_team["name"]), players=players))
        self.teams = tuple(teams)
        self.toss_winner = str(setup["toss_winner_team_id"])
        self.toss_decision = str(setup["toss_decision"])
        self.names = {
            player.id: player.name for team in self.teams for player in team.players
        }
        self.squads = {
            team.id: frozenset(player.id for player in team.players) for team in self.teams
        }
        self.innings_starts: list[dict[str, Any]] = [
            {
                "innings_number": int(item["innings_number"]),
                "batting_team_id": str(item["batting_team_id"]),
                "bowling_team_id": str(item["bowling_team_id"]),
                "striker_id": str(item["striker_id"]),
                "non_striker_id": str(item["non_striker_id"]),
                "opening_bowler_id": str(item["opening_bowler_id"]),
            }
            for item in (innings or [])
        ]
        self.balls = sorted(
            (copy.deepcopy(ball) for ball in (balls or [])),
            key=lambda ball: ball.seq,
        )

    def state(self) -> dict[str, Any]:
        return self._replay().to_state()

    def has_innings(self, number: int) -> bool:
        return any(start["innings_number"] == number for start in self.innings_starts)

    def start_innings(self, body: Mapping[str, Any]) -> dict[str, Any]:
        number = int(body["innings_number"])
        if self.has_innings(number):
            raise ScoringError("innings_not_ready")
        status = self._replay().status
        if number == 1 and status != "not_started":
            raise ScoringError("innings_not_ready")
        if number == 2 and status != "innings_break":
            raise ScoringError("innings_not_ready")
        batting, bowling = self._sides(number)
        if str(body["batting_team_id"]) != batting or str(body["bowling_team_id"]) != bowling:
            raise ScoringError("innings_lineup")
        striker = str(body["striker_id"])
        non_striker = str(body["non_striker_id"])
        bowler = str(body["opening_bowler_id"])
        if (
            striker == non_striker
            or striker not in self.squads.get(batting, ())
            or non_striker not in self.squads.get(batting, ())
            or bowler not in self.squads.get(bowling, ())
        ):
            raise ScoringError("innings_lineup")
        self.innings_starts.append(
            {
                "innings_number": number,
                "batting_team_id": batting,
                "bowling_team_id": bowling,
                "striker_id": striker,
                "non_striker_id": non_striker,
                "opening_bowler_id": bowler,
            }
        )
        return self.state()

    def apply_ball(self, event: Mapping[str, Any]) -> ApplyResult:
        canonical = canonical_uuid(event["client_uuid"])
        existing = self._find(canonical)
        if existing is not None:
            if existing.delivery() != _event_delivery(event):
                raise ScoringError("uuid_conflict")
            return ApplyResult("duplicate", existing.seq, None, canonical)
        highest = max((ball.seq for ball in self.balls), default=0)
        if int(event["seq"]) != highest + 1:
            raise ScoringError("seq_gap")
        sim = self._replay()
        self._reject(sim, event)
        number = int(event["innings_number"])
        innings = sim.innings_by_number(number)
        assert innings is not None
        ball = _ball_from_event(
            event,
            canonical,
            over_index=innings.legal_balls // 6,
            ball_in_over=(innings.legal_balls % 6) + 1,
        )
        self.balls.append(ball)
        return ApplyResult("applied", ball.seq, ball, canonical)

    def apply_batch(self, events: Sequence[Mapping[str, Any]]) -> BatchOutcome:
        saved = copy.deepcopy(self.balls)
        results: list[dict[str, Any]] = []
        frames: list[dict[str, Any]] = []
        new_balls: list[Ball] = []
        try:
            for event in events:
                applied = self.apply_ball(event)
                results.append(
                    {
                        "client_uuid": applied.client_uuid,
                        "status": applied.status,
                        "seq": applied.seq,
                    }
                )
                if applied.status == "applied" and applied.ball is not None:
                    new_balls.append(applied.ball)
                    frames.append(
                        {
                            "type": "ball",
                            "event": applied.ball.to_event(),
                            "state": self.state(),
                        }
                    )
            return BatchOutcome(results, self.state(), frames, new_balls)
        except ScoringError:
            self.balls = saved
            raise

    def undo(self) -> str:
        live = [ball for ball in self.balls if not ball.voided]
        if not live:
            raise ScoringError("nothing_to_undo")
        target = max(live, key=lambda ball: ball.seq)
        target.voided = True
        return target.client_uuid

    def _find(self, client_uuid: str) -> Ball | None:
        for ball in self.balls:
            if ball.client_uuid == client_uuid:
                return ball
        return None

    def _replay(self) -> _Sim:
        sim = _Sim(self)
        for start in self.innings_starts:
            sim.open_innings(start)
            number = int(start["innings_number"])
            for ball in self.balls:
                if ball.voided or ball.innings_number != number:
                    continue
                sim.apply(ball)
        return sim

    def _sides(self, number: int) -> tuple[str, str]:
        ids = [team.id for team in self.teams]
        if self.toss_winner not in ids:
            raise ScoringError("innings_lineup")
        other = ids[0] if ids[1] == self.toss_winner else ids[1]
        if self.toss_decision == "bat":
            first_bat, first_bowl = self.toss_winner, other
        else:
            first_bat, first_bowl = other, self.toss_winner
        if number == 1:
            return first_bat, first_bowl
        return first_bowl, first_bat

    def _reject(self, sim: _Sim, event: Mapping[str, Any]) -> None:
        # Precedence follows RULES.md. seq_gap and uuid_conflict are handled
        # before this runs, and only for a client_uuid that is not an exact duplicate.
        number = int(event["innings_number"])
        inn = sim.innings_by_number(number)
        if inn is None:
            raise ScoringError("innings_not_ready")
        if sim.status != f"innings_{number}" or inn.complete:
            raise ScoringError("innings_closed")

        striker_id = str(event["striker_id"])
        non_striker_id = None if event["non_striker_id"] is None else str(event["non_striker_id"])
        bowler_id = str(event["bowler_id"])
        dismissed_id = None if event["dismissed_id"] is None else str(event["dismissed_id"])
        fielder_id = None if event["fielder_id"] is None else str(event["fielder_id"])
        runs_bat = int(event["runs_bat"])
        extra_type = event["extra_type"]
        wicket_type = event["wicket_type"]

        batting = sim.squads[inn.batting_team_id]
        bowling = sim.squads[inn.bowling_team_id]
        if (
            striker_id not in batting
            or (non_striker_id is not None and non_striker_id not in batting)
            or (dismissed_id is not None and dismissed_id not in batting)
            or bowler_id not in bowling
            or (fielder_id is not None and fielder_id not in bowling)
        ):
            raise ScoringError("player_not_on_team")

        assert inn.batting is not None
        out_ids = {row.player_id for row in inn.batting if row.out}
        named = [striker_id, bowler_id]
        if non_striker_id is not None:
            named.append(non_striker_id)
        if any(player_id in out_ids for player_id in named):
            raise ScoringError("dismissed_player_bats_again")

        _reject_crease(sim, inn, striker_id, non_striker_id, out_ids)

        if inn.deliveries == 0 and bowler_id != inn.opening_bowler_id:
            raise ScoringError("opening_bowler_required")
        if sim.needs_new_bowler and bowler_id == sim.bowler_id:
            raise ScoringError("same_bowler_consecutive_overs")

        if extra_type == "wide" and runs_bat != 0:
            raise ScoringError("wide_with_bat_runs")
        if extra_type == "bye" and runs_bat != 0:
            raise ScoringError("bye_with_bat_runs")
        if extra_type == "leg_bye" and runs_bat != 0:
            raise ScoringError("leg_bye_with_bat_runs")

        if extra_type == "no_ball" and wicket_type is not None and wicket_type != "run_out":
            raise ScoringError("no_ball_illegal_wicket")
        if extra_type == "wide" and wicket_type is not None and wicket_type not in {
            "run_out",
            "stumped",
        }:
            raise ScoringError("wide_illegal_wicket")
        if (
            extra_type in {"bye", "leg_bye"}
            and wicket_type is not None
            and wicket_type != "run_out"
        ):
            raise ScoringError("bye_illegal_wicket")

        if (wicket_type is None) != (dismissed_id is None):
            raise ScoringError("illegal_dismissal")
        if wicket_type in _STRIKER_WICKET and dismissed_id != striker_id:
            raise ScoringError("illegal_dismissal")
        if wicket_type == "run_out":
            allowed = {striker_id}
            if non_striker_id is not None:
                allowed.add(non_striker_id)
            if dismissed_id not in allowed:
                raise ScoringError("illegal_dismissal")

        if wicket_type in _FIELDER_WICKET and fielder_id is None:
            raise ScoringError("missing_fielder")
        if wicket_type not in _FIELDER_WICKET and fielder_id is not None:
            raise ScoringError("unexpected_fielder")

        over_hint = event.get("over_index")
        ball_hint = event.get("ball_in_over")
        has_over = over_hint is not None
        has_ball = ball_hint is not None
        if has_over != has_ball:
            raise ScoringError("hint_mismatch")
        if has_over:
            if (
                isinstance(over_hint, bool)
                or isinstance(ball_hint, bool)
                or not isinstance(over_hint, int)
                or not isinstance(ball_hint, int)
                or over_hint != inn.legal_balls // 6
                or ball_hint != (inn.legal_balls % 6) + 1
            ):
                raise ScoringError("hint_mismatch")


def _reject_crease(
    sim: _Sim,
    inn: InningsState,
    striker_id: str,
    non_striker_id: str | None,
    out_ids: set[str],
) -> None:
    needs = sim.needs_new_batter
    if needs is None:
        if striker_id != sim.striker_id or non_striker_id != sim.non_striker_id:
            raise ScoringError("crease_mismatch")
        return
    not_out = set(sim.squads[inn.batting_team_id]) - out_ids
    if needs == "striker":
        partner = sim.non_striker_id
        waiting = not_out - ({partner} if partner is not None else set())
        if not waiting:
            if striker_id != partner or non_striker_id is not None:
                raise ScoringError("crease_mismatch")
            return
        if non_striker_id != partner or striker_id not in waiting:
            raise ScoringError("crease_mismatch")
        return
    if striker_id != sim.striker_id:
        raise ScoringError("crease_mismatch")
    waiting = not_out - ({sim.striker_id} if sim.striker_id is not None else set())
    if not waiting:
        if non_striker_id is not None:
            raise ScoringError("crease_mismatch")
        return
    if non_striker_id not in waiting:
        raise ScoringError("crease_mismatch")


def _ball_from_event(
    event: Mapping[str, Any],
    client_uuid: str,
    *,
    over_index: int,
    ball_in_over: int,
) -> Ball:
    return Ball(
        client_uuid=client_uuid,
        seq=int(event["seq"]),
        innings_number=int(event["innings_number"]),
        striker_id=str(event["striker_id"]),
        non_striker_id=None if event["non_striker_id"] is None else str(event["non_striker_id"]),
        bowler_id=str(event["bowler_id"]),
        runs_bat=int(event["runs_bat"]),
        extra_type=event["extra_type"],
        extra_runs=int(event["extra_runs"]),
        wicket_type=event["wicket_type"],
        dismissed_id=None if event["dismissed_id"] is None else str(event["dismissed_id"]),
        fielder_id=None if event["fielder_id"] is None else str(event["fielder_id"]),
        over_index=over_index,
        ball_in_over=ball_in_over,
    )


def _play_ops(engine: Engine, fixture: Mapping[str, Any]) -> None:
    starts = {int(item["innings_number"]): item for item in fixture["innings"]}
    for op in fixture["ops"]:
        if op["op"] == "undo":
            engine.undo()
            continue
        event = op["event"]
        number = int(event["innings_number"])
        if not engine.has_innings(number):
            engine.start_innings(starts[number])
        engine.apply_ball(event)


def play_valid(fixture: Mapping[str, Any]) -> dict[str, Any]:
    engine = Engine(fixture["setup"])
    _play_ops(engine, fixture)
    return engine.state()


def prepare_invalid(fixture: Mapping[str, Any]) -> Engine:
    engine = Engine(fixture["setup"])
    _play_ops(engine, fixture)
    event = fixture["illegal"]["event"]
    number = int(event["innings_number"])
    if not engine.has_innings(number):
        starts = {int(item["innings_number"]): item for item in fixture["innings"]}
        engine.start_innings(starts[number])
    return engine
