export type ExtraType = "wide" | "no_ball" | "bye" | "leg_bye" | null;

export type WicketType =
  | "bowled"
  | "caught"
  | "run_out"
  | "stumped"
  | "lbw"
  | "hit_wicket"
  | null;

export type TossDecision = "bat" | "bowl";

export type Status = "not_started" | "innings_1" | "innings_break" | "innings_2" | "complete";

export type NeedsNewBatter = "striker" | "non_striker" | null;

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
}

export interface Rules {
  wide_runs: number;
  no_ball_runs: number;
  last_man_stands: boolean;
}

export interface Setup {
  overs: number;
  rules?: Partial<Rules>;
  teams: Team[];
  toss_winner_team_id: string;
  toss_decision: TossDecision;
}

export interface InningsStart {
  innings_number: 1 | 2;
  batting_team_id: string;
  bowling_team_id: string;
  striker_id: string;
  non_striker_id: string;
  opening_bowler_id: string;
}

export interface BallEvent {
  client_uuid: string;
  seq: number;
  innings_number: 1 | 2;
  striker_id: string;
  non_striker_id: string | null;
  bowler_id: string;
  runs_bat: number;
  extra_type: ExtraType;
  extra_runs: number;
  wicket_type: WicketType;
  dismissed_id: string | null;
  fielder_id: string | null;
  over_index?: number;
  ball_in_over?: number;
}

export interface StoredBall extends BallEvent {
  over_index: number;
  ball_in_over: number;
  voided: boolean;
}

export interface MatchDocument {
  overs: number;
  rules: Rules;
  teams: Team[];
  tossWinnerTeamId: string;
  tossDecision: TossDecision;
  innings: InningsStart[];
  balls: StoredBall[];
}

export interface TeamSummary {
  id: string;
  name: string;
}

export interface OversShape {
  overs: number;
  balls: number;
  display: string;
}

export interface Extras {
  wide: number;
  no_ball: number;
  bye: number;
  leg_bye: number;
  total: number;
}

export interface BattingRow {
  player_id: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal: string;
}

export interface BowlingRow {
  player_id: string;
  name: string;
  overs: OversShape;
  maidens: number;
  runs: number;
  wickets: number;
}

export interface FallOfWicket {
  wicket: number;
  runs: number;
  batter_id: string;
}

export interface Partnership {
  wicket: number;
  batter1_id: string;
  batter1_runs: number;
  batter1_balls: number;
  batter2_id: string | null;
  batter2_runs: number;
  batter2_balls: number;
  runs: number;
  balls: number;
}

export interface Toss {
  winner_team_id: string;
  decision: TossDecision;
}

export interface InningsView {
  innings_number: 1 | 2;
  batting_team_id: string;
  bowling_team_id: string;
  runs: number;
  wickets: number;
  overs: OversShape;
  target: number | null;
  complete: boolean;
  extras: Extras;
  batting: BattingRow[];
  bowling: BowlingRow[];
  fall_of_wickets: FallOfWicket[];
  overs_timeline: string[][];
  partnerships: Partnership[];
}

export interface WinResult {
  winner_team_id: string;
  margin: number;
  margin_unit: "wickets" | "runs";
}

export interface TieResult {
  tie: true;
}

export type Result = WinResult | TieResult | null;

export interface MatchState {
  status: Status;
  result: Result;
  overs: number;
  rules: Rules;
  teams: TeamSummary[];
  innings: InningsView[];
  striker_id: string | null;
  non_striker_id: string | null;
  bowler_id: string | null;
  needs_new_batter: NeedsNewBatter;
  needs_new_bowler: boolean;
  crr: number | null;
  rrr: number | null;
  runs_needed: number | null;
  toss: Toss;
}

/** The ball the scorer is allowed to append. Seq and hints are filled by the engine. */
export interface LegalBallInput {
  clientUuid: string;
  strikerId: string;
  nonStrikerId: string | null;
  bowlerId: string;
  runsBat: number;
  extraType: ExtraType;
  extraRuns: number;
  wicketType: WicketType;
  dismissedId: string | null;
  fielderId: string | null;
}

export interface BatterOptions {
  required: boolean;
  end: NeedsNewBatter;
  options: Player[];
  forced: { strikerId: string; nonStrikerId: string | null } | null;
}

export interface BowlerOptions {
  required: boolean;
  barredId: string | null;
  options: Player[];
}
