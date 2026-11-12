import { roundHalfAwayFromZero } from "./rates";
import type { MatchState, OversShape } from "./types";

export interface HighlightBatter {
  name: string;
  runs: number;
  balls: number;
}

export interface HighlightBowler {
  name: string;
  wickets: number;
  runs: number;
}

export function formatResult(state: MatchState): string {
  const result = state.result;
  if (state.status !== "complete" || result === null) {
    return "Live";
  }
  if ("tie" in result) {
    return "Tie";
  }
  const name = state.teams.find((team) => team.id === result.winner_team_id)?.name ?? result.winner_team_id;
  const unit = result.margin === 1 ? (result.margin_unit === "wickets" ? "wicket" : "run") : result.margin_unit;
  return `${name} won by ${result.margin} ${unit}`;
}

export function topBatter(state: MatchState): HighlightBatter | null {
  const totals = new Map<string, HighlightBatter>();
  for (const innings of state.innings) {
    for (const row of innings.batting) {
      const current = totals.get(row.player_id) ?? { name: row.name, runs: 0, balls: 0 };
      current.runs += row.runs;
      current.balls += row.balls;
      totals.set(row.player_id, current);
    }
  }
  const rows = [...totals.values()];
  if (rows.length === 0) {
    return null;
  }
  rows.sort((left, right) => right.runs - left.runs || left.balls - right.balls);
  return rows[0];
}

export function topBowler(state: MatchState): HighlightBowler | null {
  const totals = new Map<string, HighlightBowler>();
  for (const innings of state.innings) {
    for (const row of innings.bowling) {
      const current = totals.get(row.player_id) ?? { name: row.name, wickets: 0, runs: 0 };
      current.wickets += row.wickets;
      current.runs += row.runs;
      totals.set(row.player_id, current);
    }
  }
  const rows = [...totals.values()];
  if (rows.length === 0) {
    return null;
  }
  rows.sort((left, right) => right.wickets - left.wickets || left.runs - right.runs);
  return rows[0];
}

export function legalBalls(overs: OversShape): number {
  return overs.overs * 6 + overs.balls;
}

export function formatStrikeRate(runs: number, balls: number): string {
  if (balls === 0) {
    return "-";
  }
  return String(roundHalfAwayFromZero(runs * 100, balls));
}

export function formatEconomy(runs: number, balls: number): string {
  if (balls === 0) {
    return "-";
  }
  return String(roundHalfAwayFromZero(runs * 6, balls));
}

export function formatInningsRate(runs: number, balls: number): string | null {
  if (balls === 0) {
    return null;
  }
  return String(roundHalfAwayFromZero(runs * 6, balls));
}

export function formatToss(state: MatchState): string {
  const winner = state.teams.find((team) => team.id === state.toss.winner_team_id);
  const name = winner?.name ?? state.toss.winner_team_id;
  return `${name} won the toss and chose to ${state.toss.decision}`;
}

export function inningsHeadline(state: MatchState, inningsNumber: 1 | 2): string | null {
  const innings = state.innings.find((item) => item.innings_number === inningsNumber);
  if (!innings) {
    return null;
  }
  const name = state.teams.find((team) => team.id === innings.batting_team_id)?.name ?? innings.batting_team_id;
  return `${name} ${innings.runs}/${innings.wickets}`;
}
