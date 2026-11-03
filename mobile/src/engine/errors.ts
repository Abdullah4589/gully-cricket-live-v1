export const ERROR_CODES = [
  "seq_gap",
  "uuid_conflict",
  "innings_not_ready",
  "innings_closed",
  "innings_lineup",
  "player_not_on_team",
  "dismissed_player_bats_again",
  "crease_mismatch",
  "opening_bowler_required",
  "same_bowler_consecutive_overs",
  "wide_with_bat_runs",
  "bye_with_bat_runs",
  "leg_bye_with_bat_runs",
  "no_ball_illegal_wicket",
  "wide_illegal_wicket",
  "bye_illegal_wicket",
  "illegal_dismissal",
  "missing_fielder",
  "unexpected_fielder",
  "hint_mismatch",
  "nothing_to_undo",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ScoringError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = "ScoringError";
    this.code = code;
  }
}

export function isScoringError(error: unknown): error is ScoringError {
  return error instanceof ScoringError;
}
