import { ScoringError } from "./errors";
import { roundHalfAwayFromZero } from "./rates";
import type {
  BallEvent,
  BatterOptions,
  BowlerOptions,
  BowlingRow,
  Extras,
  InningsStart,
  InningsView,
  LegalBallInput,
  MatchDocument,
  MatchState,
  NeedsNewBatter,
  OversShape,
  Partnership,
  Player,
  Result,
  Rules,
  Setup,
  Status,
  StoredBall,
  Team,
  WicketType,
} from "./types";

const BOWLER_CREDIT = new Set<Exclude<WicketType, null>>([
  "bowled",
  "caught",
  "stumped",
  "lbw",
  "hit_wicket",
]);

const FIELDER_WICKETS = new Set<Exclude<WicketType, null>>(["caught", "stumped", "run_out"]);

interface Charge {
  team: number;
  batter: number;
  bowler: number;
  bucket: "wide" | "no_ball" | "bye" | "leg_bye" | null;
  bucketRuns: number;
  legal: boolean;
  faced: boolean;
  swap: number;
}

interface BowlingLive {
  player_id: string;
  name: string;
  legal: number;
  maidens: number;
  runs: number;
  wickets: number;
}

interface OverBowler {
  legal: number;
  charged: number;
}

interface PartnershipLive extends Partnership {
  open: boolean;
}

interface LiveInnings {
  inningsNumber: 1 | 2;
  battingTeamId: string;
  bowlingTeamId: string;
  runs: number;
  wickets: number;
  legal: number;
  target: number | null;
  complete: boolean;
  extras: Extras;
  batting: InningsView["batting"];
  bowling: BowlingLive[];
  fallOfWickets: InningsView["fall_of_wickets"];
  timeline: string[][];
  partnerships: PartnershipLive[];
  overOpen: boolean;
  overTrack: Map<string, OverBowler>;
}

export function resolveRules(rules: Partial<Rules> | undefined): Rules {
  return {
    wide_runs: rules?.wide_runs ?? 1,
    no_ball_runs: rules?.no_ball_runs ?? 1,
    last_man_stands: rules?.last_man_stands ?? true,
  };
}

export function createMatch(setup: Setup): MatchDocument {
  return {
    overs: setup.overs,
    rules: resolveRules(setup.rules),
    teams: setup.teams.map((team) => ({
      id: team.id,
      name: team.name,
      players: team.players.map((player) => ({ id: player.id, name: player.name })),
    })),
    tossWinnerTeamId: setup.toss_winner_team_id,
    tossDecision: setup.toss_decision,
    innings: [],
    balls: [],
  };
}

export function battingTeamId(doc: MatchDocument, inningsNumber: 1 | 2): string {
  const other = doc.teams.find((team) => team.id !== doc.tossWinnerTeamId);
  if (!other) {
    throw new Error("unknown_team");
  }
  const first = doc.tossDecision === "bat" ? doc.tossWinnerTeamId : other.id;
  if (inningsNumber === 1) {
    return first;
  }
  return first === doc.tossWinnerTeamId ? other.id : doc.tossWinnerTeamId;
}

export function startInnings(doc: MatchDocument, start: InningsStart): MatchDocument {
  const state = deriveState(doc);
  if (doc.innings.some((innings) => innings.innings_number === start.innings_number)) {
    throw new ScoringError("innings_not_ready");
  }
  if (start.innings_number === 1) {
    if (state.status !== "not_started") {
      throw new ScoringError("innings_not_ready");
    }
  } else if (state.status !== "innings_break") {
    throw new ScoringError("innings_not_ready");
  }

  const expectedBat = battingTeamId(doc, start.innings_number);
  const expectedBowl = otherTeamId(doc, expectedBat);
  if (start.batting_team_id !== expectedBat || start.bowling_team_id !== expectedBowl) {
    throw new ScoringError("innings_lineup");
  }
  const batting = teamById(doc, start.batting_team_id);
  const bowling = teamById(doc, start.bowling_team_id);
  const batters = new Set(batting.players.map((player) => player.id));
  const bowlers = new Set(bowling.players.map((player) => player.id));
  if (
    start.striker_id === start.non_striker_id ||
    !batters.has(start.striker_id) ||
    !batters.has(start.non_striker_id) ||
    !bowlers.has(start.opening_bowler_id)
  ) {
    throw new ScoringError("innings_lineup");
  }
  return { ...doc, innings: [...doc.innings, { ...start }] };
}

export function appendBall(doc: MatchDocument, event: BallEvent): MatchDocument {
  const existing = doc.balls.find((ball) => ball.client_uuid === event.client_uuid);
  if (existing && sameDelivery(existing, event)) {
    return doc;
  }
  const maxSeq = doc.balls.reduce((max, ball) => Math.max(max, ball.seq), 0);
  if (event.seq !== maxSeq + 1) {
    throw new ScoringError("seq_gap");
  }
  if (existing) {
    throw new ScoringError("uuid_conflict");
  }

  const started = doc.innings.find((innings) => innings.innings_number === event.innings_number);
  if (!started) {
    throw new ScoringError("innings_not_ready");
  }
  const state = deriveState(doc);
  const view = state.innings.find((innings) => innings.innings_number === event.innings_number);
  const openStatus: Status = event.innings_number === 1 ? "innings_1" : "innings_2";
  if (!view || view.complete || state.status !== openStatus) {
    throw new ScoringError("innings_closed");
  }

  const battingIds = new Set(teamById(doc, started.batting_team_id).players.map((player) => player.id));
  const bowlingIds = new Set(teamById(doc, started.bowling_team_id).players.map((player) => player.id));
  if (
    !battingIds.has(event.striker_id) ||
    (event.non_striker_id !== null && !battingIds.has(event.non_striker_id)) ||
    (event.dismissed_id !== null && !battingIds.has(event.dismissed_id)) ||
    !bowlingIds.has(event.bowler_id) ||
    (event.fielder_id !== null && !bowlingIds.has(event.fielder_id))
  ) {
    throw new ScoringError("player_not_on_team");
  }

  const dismissed = dismissedIds(doc, event.innings_number);
  if (
    dismissed.has(event.striker_id) ||
    (event.non_striker_id !== null && dismissed.has(event.non_striker_id)) ||
    dismissed.has(event.bowler_id)
  ) {
    throw new ScoringError("dismissed_player_bats_again");
  }

  if (!creaseMatches(doc, state, event)) {
    throw new ScoringError("crease_mismatch");
  }

  const prior = doc.balls.filter((ball) => !ball.voided && ball.innings_number === event.innings_number);
  if (prior.length === 0 && event.bowler_id !== started.opening_bowler_id) {
    throw new ScoringError("opening_bowler_required");
  }
  if (state.needs_new_bowler && event.bowler_id === state.bowler_id) {
    throw new ScoringError("same_bowler_consecutive_overs");
  }

  if (event.extra_type === "wide" && event.runs_bat !== 0) {
    throw new ScoringError("wide_with_bat_runs");
  }
  if (event.extra_type === "bye" && event.runs_bat !== 0) {
    throw new ScoringError("bye_with_bat_runs");
  }
  if (event.extra_type === "leg_bye" && event.runs_bat !== 0) {
    throw new ScoringError("leg_bye_with_bat_runs");
  }

  if (event.extra_type === "no_ball" && event.wicket_type !== null && event.wicket_type !== "run_out") {
    throw new ScoringError("no_ball_illegal_wicket");
  }
  if (
    event.extra_type === "wide" &&
    event.wicket_type !== null &&
    event.wicket_type !== "run_out" &&
    event.wicket_type !== "stumped"
  ) {
    throw new ScoringError("wide_illegal_wicket");
  }
  if (
    (event.extra_type === "bye" || event.extra_type === "leg_bye") &&
    event.wicket_type !== null &&
    event.wicket_type !== "run_out"
  ) {
    throw new ScoringError("bye_illegal_wicket");
  }

  const hasWicket = event.wicket_type !== null;
  const hasDismissed = event.dismissed_id !== null;
  if (hasWicket !== hasDismissed) {
    throw new ScoringError("illegal_dismissal");
  }
  if (event.wicket_type !== null && event.dismissed_id !== null) {
    if (BOWLER_CREDIT.has(event.wicket_type) && event.dismissed_id !== event.striker_id) {
      throw new ScoringError("illegal_dismissal");
    }
    if (event.wicket_type === "run_out" && event.dismissed_id !== event.striker_id && event.dismissed_id !== event.non_striker_id) {
      throw new ScoringError("illegal_dismissal");
    }
  }

  const needsFielder = event.wicket_type !== null && FIELDER_WICKETS.has(event.wicket_type);
  if (needsFielder && event.fielder_id === null) {
    throw new ScoringError("missing_fielder");
  }
  if (!needsFielder && event.fielder_id !== null) {
    throw new ScoringError("unexpected_fielder");
  }

  const legalBefore = countLegal(doc, event.innings_number);
  const overIndex = Math.floor(legalBefore / 6);
  const ballInOver = (legalBefore % 6) + 1;
  const sentOver = event.over_index !== undefined;
  const sentBall = event.ball_in_over !== undefined;
  if (sentOver !== sentBall || (sentOver && (event.over_index !== overIndex || event.ball_in_over !== ballInOver))) {
    throw new ScoringError("hint_mismatch");
  }

  const stored: StoredBall = {
    client_uuid: event.client_uuid,
    seq: event.seq,
    innings_number: event.innings_number,
    striker_id: event.striker_id,
    non_striker_id: event.non_striker_id,
    bowler_id: event.bowler_id,
    runs_bat: event.runs_bat,
    extra_type: event.extra_type,
    extra_runs: event.extra_runs,
    wicket_type: event.wicket_type,
    dismissed_id: event.dismissed_id,
    fielder_id: event.fielder_id,
    over_index: overIndex,
    ball_in_over: ballInOver,
    voided: false,
  };
  return { ...doc, balls: [...doc.balls, stored] };
}

/** Append one legal ball. The scorer passes the crease and the shot; seq and hints are derived. */
export function appendLegalBall(doc: MatchDocument, input: LegalBallInput): MatchDocument {
  const state = deriveState(doc);
  const inningsNumber = openInningsNumber(state);
  if (inningsNumber === null) {
    throw new ScoringError("innings_not_ready");
  }
  const legalBefore = countLegal(doc, inningsNumber);
  const maxSeq = doc.balls.reduce((max, ball) => Math.max(max, ball.seq), 0);
  return appendBall(doc, {
    client_uuid: input.clientUuid,
    seq: maxSeq + 1,
    innings_number: inningsNumber,
    striker_id: input.strikerId,
    non_striker_id: input.nonStrikerId,
    bowler_id: input.bowlerId,
    runs_bat: input.runsBat,
    extra_type: input.extraType,
    extra_runs: input.extraRuns,
    wicket_type: input.wicketType,
    dismissed_id: input.dismissedId,
    fielder_id: input.fielderId,
    over_index: Math.floor(legalBefore / 6),
    ball_in_over: (legalBefore % 6) + 1,
  });
}

export function undoLastBall(doc: MatchDocument): MatchDocument {
  const target = undoTargetIndex(doc);
  if (target === -1) {
    throw new ScoringError("nothing_to_undo");
  }
  return {
    ...doc,
    balls: doc.balls.map((ball, index) => (index === target ? { ...ball, voided: true } : ball)),
  };
}

export function peekUndoUuid(doc: MatchDocument): string | null {
  const target = undoTargetIndex(doc);
  return target === -1 ? null : doc.balls[target].client_uuid;
}

export function ballEvent(ball: StoredBall): BallEvent {
  return {
    client_uuid: ball.client_uuid,
    seq: ball.seq,
    innings_number: ball.innings_number,
    striker_id: ball.striker_id,
    non_striker_id: ball.non_striker_id,
    bowler_id: ball.bowler_id,
    runs_bat: ball.runs_bat,
    extra_type: ball.extra_type,
    extra_runs: ball.extra_runs,
    wicket_type: ball.wicket_type,
    dismissed_id: ball.dismissed_id,
    fielder_id: ball.fielder_id,
    over_index: ball.over_index,
    ball_in_over: ball.ball_in_over,
  };
}

export function deriveState(doc: MatchDocument): MatchState {
  let status: Status = "not_started";
  let result: Result = null;
  let strikerId: string | null = null;
  let nonStrikerId: string | null = null;
  let bowlerId: string | null = null;
  let needsNewBatter: NeedsNewBatter = null;
  let needsNewBowler = false;
  const innings: InningsView[] = [];

  for (const start of doc.innings) {
    const live = beginInnings(doc, start, innings);
    status = start.innings_number === 1 ? "innings_1" : "innings_2";
    strikerId = start.striker_id;
    nonStrikerId = start.non_striker_id;
    bowlerId = start.opening_bowler_id;
    needsNewBatter = null;
    needsNewBowler = false;

    const balls = doc.balls
      .filter((ball) => !ball.voided && ball.innings_number === start.innings_number)
      .slice()
      .sort((left, right) => left.seq - right.seq);

    for (const ball of balls) {
      const step = applyDelivery(doc, live, ball);
      strikerId = step.strikerId;
      nonStrikerId = step.nonStrikerId;
      bowlerId = ball.bowler_id;
      needsNewBatter = step.needsNewBatter;
      needsNewBowler = step.needsNewBowler;
      if (step.ended) {
        needsNewBatter = null;
        needsNewBowler = false;
        live.complete = true;
        if (start.innings_number === 1) {
          status = "innings_break";
          result = null;
        } else {
          status = "complete";
          result = step.result;
        }
      }
    }
    innings.push(freezeInnings(live));
  }

  const rates = ratesFor(doc, status, innings);
  return {
    status,
    result,
    overs: doc.overs,
    rules: { ...doc.rules },
    teams: doc.teams.map((team) => ({ id: team.id, name: team.name })),
    innings,
    striker_id: strikerId,
    non_striker_id: nonStrikerId,
    bowler_id: bowlerId,
    needs_new_batter: needsNewBatter,
    needs_new_bowler: needsNewBowler,
    crr: rates.crr,
    rrr: rates.rrr,
    runs_needed: rates.runs_needed,
    toss: { winner_team_id: doc.tossWinnerTeamId, decision: doc.tossDecision },
  };
}

export function batterOptions(doc: MatchDocument): BatterOptions {
  return batterOptionsFrom(doc, deriveState(doc));
}

export function bowlerOptions(doc: MatchDocument): BowlerOptions {
  const state = deriveState(doc);
  if (!state.needs_new_bowler || state.bowler_id === null) {
    return { required: false, barredId: null, options: [] };
  }
  const start = openStart(doc, state);
  if (!start) {
    return { required: false, barredId: null, options: [] };
  }
  const options = teamById(doc, start.bowling_team_id).players.filter((player) => player.id !== state.bowler_id);
  return { required: true, barredId: state.bowler_id, options };
}

export function teamPlayers(doc: MatchDocument, teamId: string): Player[] {
  return teamById(doc, teamId).players.map((player) => ({ ...player }));
}

function batterOptionsFrom(doc: MatchDocument, state: MatchState): BatterOptions {
  if (state.needs_new_batter === null) {
    return { required: false, end: null, options: [], forced: null };
  }
  const start = openStart(doc, state);
  if (!start || state.striker_id === null) {
    return { required: false, end: null, options: [], forced: null };
  }
  const out = dismissedIds(doc, start.innings_number);
  const waiting = teamById(doc, start.batting_team_id).players.filter((player) => !out.has(player.id));
  if (state.needs_new_batter === "striker") {
    const options = waiting.filter((player) => player.id !== state.non_striker_id);
    if (options.length === 0 && state.non_striker_id !== null) {
      return {
        required: true,
        end: "striker",
        options: [],
        forced: { strikerId: state.non_striker_id, nonStrikerId: null },
      };
    }
    return { required: true, end: "striker", options, forced: null };
  }
  const options = waiting.filter((player) => player.id !== state.striker_id);
  if (options.length === 0) {
    return {
      required: true,
      end: "non_striker",
      options: [],
      forced: { strikerId: state.striker_id, nonStrikerId: null },
    };
  }
  return { required: true, end: "non_striker", options, forced: null };
}

function creaseMatches(doc: MatchDocument, state: MatchState, event: BallEvent): boolean {
  const choice = batterOptionsFrom(doc, state);
  if (!choice.required) {
    return event.striker_id === state.striker_id && event.non_striker_id === state.non_striker_id;
  }
  if (choice.forced) {
    return event.striker_id === choice.forced.strikerId && event.non_striker_id === choice.forced.nonStrikerId;
  }
  if (choice.end === "striker") {
    return event.non_striker_id === state.non_striker_id && choice.options.some((player) => player.id === event.striker_id);
  }
  return event.striker_id === state.striker_id && choice.options.some((player) => player.id === event.non_striker_id);
}

function openStart(doc: MatchDocument, state: MatchState): InningsStart | undefined {
  const number = openInningsNumber(state);
  if (number === null) {
    return undefined;
  }
  return doc.innings.find((innings) => innings.innings_number === number);
}

function openInningsNumber(state: MatchState): 1 | 2 | null {
  if (state.status === "innings_1") return 1;
  if (state.status === "innings_2") return 2;
  return null;
}

function undoTargetIndex(doc: MatchDocument): number {
  let index = -1;
  let best = -1;
  doc.balls.forEach((ball, ballIndex) => {
    if (!ball.voided && ball.seq > best) {
      best = ball.seq;
      index = ballIndex;
    }
  });
  return index;
}

function sameDelivery(stored: BallEvent, event: BallEvent): boolean {
  return (
    stored.seq === event.seq &&
    stored.innings_number === event.innings_number &&
    stored.striker_id === event.striker_id &&
    stored.non_striker_id === event.non_striker_id &&
    stored.bowler_id === event.bowler_id &&
    stored.runs_bat === event.runs_bat &&
    stored.extra_type === event.extra_type &&
    stored.extra_runs === event.extra_runs &&
    stored.wicket_type === event.wicket_type &&
    stored.dismissed_id === event.dismissed_id &&
    stored.fielder_id === event.fielder_id
  );
}

function countLegal(doc: MatchDocument, inningsNumber: 1 | 2): number {
  return doc.balls.filter(
    (ball) =>
      !ball.voided &&
      ball.innings_number === inningsNumber &&
      ball.extra_type !== "wide" &&
      ball.extra_type !== "no_ball",
  ).length;
}

function dismissedIds(doc: MatchDocument, inningsNumber: 1 | 2): Set<string> {
  const ids = new Set<string>();
  for (const ball of doc.balls) {
    if (!ball.voided && ball.innings_number === inningsNumber && ball.dismissed_id !== null) {
      ids.add(ball.dismissed_id);
    }
  }
  return ids;
}

function teamById(doc: MatchDocument, id: string): Team {
  const team = doc.teams.find((item) => item.id === id);
  if (!team) {
    throw new Error("unknown_team");
  }
  return team;
}

function otherTeamId(doc: MatchDocument, teamId: string): string {
  const other = doc.teams.find((team) => team.id !== teamId);
  if (!other) {
    throw new Error("unknown_team");
  }
  return other.id;
}

function playerName(doc: MatchDocument, id: string): string {
  for (const team of doc.teams) {
    const player = team.players.find((item) => item.id === id);
    if (player) {
      return player.name;
    }
  }
  throw new Error("unknown_player");
}

function beginInnings(doc: MatchDocument, start: InningsStart, previous: InningsView[]): LiveInnings {
  const target = start.innings_number === 2 ? (previous[0]?.runs ?? 0) + 1 : null;
  const live: LiveInnings = {
    inningsNumber: start.innings_number,
    battingTeamId: start.batting_team_id,
    bowlingTeamId: start.bowling_team_id,
    runs: 0,
    wickets: 0,
    legal: 0,
    target,
    complete: false,
    extras: { wide: 0, no_ball: 0, bye: 0, leg_bye: 0, total: 0 },
    batting: [],
    bowling: [],
    fallOfWickets: [],
    timeline: [],
    partnerships: [],
    overOpen: false,
    overTrack: new Map(),
  };
  ensureBatter(doc, live, start.striker_id);
  ensureBatter(doc, live, start.non_striker_id);
  live.partnerships.push(newPartnership(1, start.striker_id, start.non_striker_id));
  return live;
}

function applyDelivery(
  doc: MatchDocument,
  live: LiveInnings,
  event: BallEvent,
): { strikerId: string; nonStrikerId: string | null; needsNewBatter: NeedsNewBatter; needsNewBowler: boolean; ended: boolean; result: Result } {
  const charge = deliveryCharge(event, doc.rules);
  const partnership = partnershipFor(live, event.striker_id, event.non_striker_id);
  creditPartnership(partnership, event.striker_id, charge.batter, charge.faced, charge.team);
  if (!live.overOpen) {
    live.overTrack = new Map();
    live.timeline.push([]);
    live.overOpen = true;
  }

  ensureBatter(doc, live, event.striker_id);
  if (event.non_striker_id !== null) {
    ensureBatter(doc, live, event.non_striker_id);
  }
  const batter = live.batting.find((row) => row.player_id === event.striker_id);
  if (!batter) {
    throw new Error("unknown_player");
  }
  batter.runs += charge.batter;
  if (charge.faced) {
    batter.balls += 1;
  }
  if (event.runs_bat === 4) {
    batter.fours += 1;
  }
  if (event.runs_bat === 6) {
    batter.sixes += 1;
  }

  live.runs += charge.team;
  if (charge.bucket !== null) {
    live.extras[charge.bucket] += charge.bucketRuns;
  }
  live.extras.total = live.extras.wide + live.extras.no_ball + live.extras.bye + live.extras.leg_bye;

  const bowler = ensureBowler(doc, live, event.bowler_id);
  bowler.runs += charge.bowler;
  if (charge.legal) {
    bowler.legal += 1;
    live.legal += 1;
  }
  const track = live.overTrack.get(event.bowler_id) ?? { legal: 0, charged: 0 };
  if (charge.legal) {
    track.legal += 1;
  }
  track.charged += charge.bowler;
  live.overTrack.set(event.bowler_id, track);

  const list = live.timeline[live.timeline.length - 1];
  list.push(tokenFor(event));

  if (event.wicket_type !== null && event.dismissed_id !== null) {
    const dismissed = live.batting.find((row) => row.player_id === event.dismissed_id);
    if (!dismissed) {
      throw new Error("unknown_player");
    }
    dismissed.out = true;
    dismissed.dismissal = dismissalText(doc, event);
    live.wickets += 1;
    live.fallOfWickets.push({ wicket: live.wickets, runs: live.runs, batter_id: event.dismissed_id });
    partnership.open = false;
    if (BOWLER_CREDIT.has(event.wicket_type)) {
      bowler.wickets += 1;
    }
  }

  let strikerId = event.striker_id;
  let nonStrikerId = event.non_striker_id;
  // A wicket suppresses the run swap. The end-of-over swap still happens.
  if (event.wicket_type === null && charge.swap % 2 === 1 && nonStrikerId !== null) {
    const previous = strikerId;
    strikerId = nonStrikerId;
    nonStrikerId = previous;
  }
  const overDone = charge.legal && live.legal % 6 === 0;
  if (overDone && nonStrikerId !== null) {
    const previous = strikerId;
    strikerId = nonStrikerId;
    nonStrikerId = previous;
  }
  if (overDone) {
    awardMaiden(live);
    live.overOpen = false;
  }

  let needsNewBatter: NeedsNewBatter = null;
  if (event.dismissed_id !== null) {
    if (event.dismissed_id === strikerId) {
      needsNewBatter = "striker";
    } else if (event.dismissed_id === nonStrikerId) {
      needsNewBatter = "non_striker";
    }
  }
  let needsNewBowler = overDone;

  const squad = teamById(doc, live.battingTeamId).players.length;
  const threshold = doc.rules.last_man_stands ? squad : squad - 1;
  const allOut = live.wickets >= threshold;
  const oversDone = live.legal >= doc.overs * 6;
  const chased = live.inningsNumber === 2 && live.target !== null && live.runs >= live.target;
  const ended = allOut || oversDone || chased;
  let result: Result = null;
  if (ended) {
    needsNewBatter = null;
    needsNewBowler = false;
    if (live.inningsNumber === 2 && live.target !== null) {
      result = chaseResult(live, threshold);
    }
  }
  return { strikerId, nonStrikerId, needsNewBatter, needsNewBowler, ended, result };
}

function chaseResult(live: LiveInnings, threshold: number): Result {
  const target = live.target;
  if (target === null) {
    return null;
  }
  if (live.runs >= target) {
    return {
      winner_team_id: live.battingTeamId,
      margin: threshold - live.wickets,
      margin_unit: "wickets",
    };
  }
  if (live.runs === target - 1) {
    return { tie: true };
  }
  return {
    winner_team_id: live.bowlingTeamId,
    margin: target - 1 - live.runs,
    margin_unit: "runs",
  };
}

function awardMaiden(live: LiveInnings): void {
  if (live.overTrack.size !== 1) {
    return;
  }
  const entry = live.overTrack.entries().next().value;
  if (!entry) {
    return;
  }
  const [playerId, stat] = entry;
  if (stat.legal === 6 && stat.charged === 0) {
    const row = live.bowling.find((bowler) => bowler.player_id === playerId);
    if (row) {
      row.maidens += 1;
    }
  }
}

function deliveryCharge(event: BallEvent, rules: Rules): Charge {
  switch (event.extra_type) {
    case null:
      return {
        team: event.runs_bat,
        batter: event.runs_bat,
        bowler: event.runs_bat,
        bucket: null,
        bucketRuns: 0,
        legal: true,
        faced: true,
        swap: event.runs_bat,
      };
    case "bye":
      return {
        team: event.extra_runs,
        batter: 0,
        bowler: 0,
        bucket: "bye",
        bucketRuns: event.extra_runs,
        legal: true,
        faced: true,
        swap: event.extra_runs,
      };
    case "leg_bye":
      return {
        team: event.extra_runs,
        batter: 0,
        bowler: 0,
        bucket: "leg_bye",
        bucketRuns: event.extra_runs,
        legal: true,
        faced: true,
        swap: event.extra_runs,
      };
    case "wide":
      return {
        team: rules.wide_runs + event.extra_runs,
        batter: 0,
        bowler: rules.wide_runs + event.extra_runs,
        bucket: "wide",
        bucketRuns: rules.wide_runs + event.extra_runs,
        legal: false,
        faced: false,
        swap: event.extra_runs,
      };
    case "no_ball":
      return {
        team: rules.no_ball_runs + event.runs_bat + event.extra_runs,
        batter: event.runs_bat,
        bowler: rules.no_ball_runs + event.runs_bat + event.extra_runs,
        bucket: "no_ball",
        bucketRuns: rules.no_ball_runs + event.extra_runs,
        legal: false,
        faced: true,
        swap: event.runs_bat + event.extra_runs,
      };
    default:
      return assertNever(event.extra_type);
  }
}

function tokenFor(event: BallEvent): string {
  let base: string;
  if (event.extra_type === "wide") {
    base = event.extra_runs === 0 ? "wd" : `wd+${event.extra_runs}`;
  } else if (event.extra_type === "no_ball") {
    const sum = event.runs_bat + event.extra_runs;
    base = sum === 0 ? "nb" : `nb+${sum}`;
  } else if (event.extra_type === "bye") {
    base = `${event.extra_runs}b`;
  } else if (event.extra_type === "leg_bye") {
    base = `${event.extra_runs}lb`;
  } else {
    base = String(event.runs_bat);
  }
  if (event.wicket_type !== null) {
    return base === "0" ? "W" : `${base}W`;
  }
  return base;
}

function dismissalText(doc: MatchDocument, event: BallEvent): string {
  const bowler = playerName(doc, event.bowler_id);
  const fielder = event.fielder_id === null ? "" : playerName(doc, event.fielder_id);
  switch (event.wicket_type) {
    case "bowled":
      return `b ${bowler}`;
    case "caught":
      return `c ${fielder} b ${bowler}`;
    case "run_out":
      return `run out (${fielder})`;
    case "stumped":
      return `st ${fielder} b ${bowler}`;
    case "lbw":
      return `lbw b ${bowler}`;
    case "hit_wicket":
      return `hit wicket b ${bowler}`;
    default:
      return "not out";
  }
}

function ensureBatter(doc: MatchDocument, live: LiveInnings, playerId: string): void {
  if (live.batting.some((row) => row.player_id === playerId)) {
    return;
  }
  live.batting.push({
    player_id: playerId,
    name: playerName(doc, playerId),
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    dismissal: "not out",
  });
}

function ensureBowler(doc: MatchDocument, live: LiveInnings, playerId: string): BowlingLive {
  const existing = live.bowling.find((row) => row.player_id === playerId);
  if (existing) {
    return existing;
  }
  const row: BowlingLive = {
    player_id: playerId,
    name: playerName(doc, playerId),
    legal: 0,
    maidens: 0,
    runs: 0,
    wickets: 0,
  };
  live.bowling.push(row);
  return row;
}

function freezeInnings(live: LiveInnings): InningsView {
  return {
    innings_number: live.inningsNumber,
    batting_team_id: live.battingTeamId,
    bowling_team_id: live.bowlingTeamId,
    runs: live.runs,
    wickets: live.wickets,
    overs: oversShape(live.legal),
    target: live.target,
    complete: live.complete,
    extras: { ...live.extras },
    batting: live.batting.map((row) => ({ ...row })),
    bowling: live.bowling.map((row) => bowlingRow(row)),
    fall_of_wickets: live.fallOfWickets.map((row) => ({ ...row })),
    overs_timeline: live.timeline.map((over) => [...over]),
    partnerships: live.partnerships.map((row) => partnershipView(row)),
  };
}

function bowlingRow(row: BowlingLive): BowlingRow {
  return {
    player_id: row.player_id,
    name: row.name,
    overs: oversShape(row.legal),
    maidens: row.maidens,
    runs: row.runs,
    wickets: row.wickets,
  };
}

function oversShape(legal: number): OversShape {
  const overs = Math.floor(legal / 6);
  const balls = legal % 6;
  return { overs, balls, display: `${overs}.${balls}` };
}

function ratesFor(
  doc: MatchDocument,
  status: Status,
  innings: InningsView[],
): { crr: number | null; rrr: number | null; runs_needed: number | null } {
  if (status === "innings_1" || status === "innings_break") {
    const first = innings.find((item) => item.innings_number === 1);
    const legal = first ? first.overs.overs * 6 + first.overs.balls : 0;
    return {
      crr: first && legal > 0 ? roundHalfAwayFromZero(first.runs * 6, legal) : null,
      rrr: null,
      runs_needed: null,
    };
  }
  if (status !== "innings_2") {
    return { crr: null, rrr: null, runs_needed: null };
  }
  const chase = innings.find((item) => item.innings_number === 2);
  if (!chase || chase.target === null) {
    return { crr: null, rrr: null, runs_needed: null };
  }
  const legal = chase.overs.overs * 6 + chase.overs.balls;
  const ballsLeft = doc.overs * 6 - legal;
  const runsNeeded = Math.max(chase.target - chase.runs, 0);
  return {
    crr: legal === 0 ? null : roundHalfAwayFromZero(chase.runs * 6, legal),
    rrr: ballsLeft === 0 ? null : roundHalfAwayFromZero(runsNeeded * 6, ballsLeft),
    runs_needed: runsNeeded,
  };
}

function newPartnership(wicket: number, batter1Id: string, batter2Id: string | null): PartnershipLive {
  return {
    wicket,
    batter1_id: batter1Id,
    batter1_runs: 0,
    batter1_balls: 0,
    batter2_id: batter2Id,
    batter2_runs: 0,
    batter2_balls: 0,
    runs: 0,
    balls: 0,
    open: true,
  };
}

function partnershipFor(live: LiveInnings, strikerId: string, nonStrikerId: string | null): PartnershipLive {
  const current = live.partnerships[live.partnerships.length - 1];
  if (current?.open && samePair(current, strikerId, nonStrikerId)) {
    return current;
  }
  if (current?.open) {
    current.open = false;
  }
  const next = newPartnership(live.wickets + 1, ...pairOrder(current, strikerId, nonStrikerId));
  live.partnerships.push(next);
  return next;
}

function samePair(partnership: PartnershipLive, strikerId: string, nonStrikerId: string | null): boolean {
  const crease = new Set<string>([strikerId]);
  if (nonStrikerId !== null) {
    crease.add(nonStrikerId);
  }
  const standing = new Set<string>([partnership.batter1_id]);
  if (partnership.batter2_id !== null) {
    standing.add(partnership.batter2_id);
  }
  if (crease.size !== standing.size) {
    return false;
  }
  for (const id of crease) {
    if (!standing.has(id)) {
      return false;
    }
  }
  return true;
}

function pairOrder(
  previous: PartnershipLive | undefined,
  strikerId: string,
  nonStrikerId: string | null,
): [string, string | null] {
  if (!previous || nonStrikerId === null) {
    return [strikerId, nonStrikerId];
  }
  const stayed = new Set<string>([previous.batter1_id]);
  if (previous.batter2_id !== null) {
    stayed.add(previous.batter2_id);
  }
  if (stayed.has(strikerId) && !stayed.has(nonStrikerId)) {
    return [strikerId, nonStrikerId];
  }
  if (stayed.has(nonStrikerId) && !stayed.has(strikerId)) {
    return [nonStrikerId, strikerId];
  }
  return [strikerId, nonStrikerId];
}

function creditPartnership(
  partnership: PartnershipLive,
  strikerId: string,
  batterRuns: number,
  faced: boolean,
  teamRuns: number,
): void {
  partnership.runs += teamRuns;
  if (faced) {
    partnership.balls += 1;
  }
  if (strikerId === partnership.batter1_id) {
    partnership.batter1_runs += batterRuns;
    if (faced) {
      partnership.batter1_balls += 1;
    }
    return;
  }
  if (partnership.batter2_id !== null && strikerId === partnership.batter2_id) {
    partnership.batter2_runs += batterRuns;
    if (faced) {
      partnership.batter2_balls += 1;
    }
  }
}

function partnershipView(row: PartnershipLive): Partnership {
  return {
    wicket: row.wicket,
    batter1_id: row.batter1_id,
    batter1_runs: row.batter1_runs,
    batter1_balls: row.batter1_balls,
    batter2_id: row.batter2_id,
    batter2_runs: row.batter2_runs,
    batter2_balls: row.batter2_balls,
    runs: row.runs,
    balls: row.balls,
  };
}

function assertNever(value: never): never {
  throw new Error(`unexpected_extra:${String(value)}`);
}

export function activeInnings(state: MatchState): 1 | 2 | null {
  return openInningsNumber(state);
}
