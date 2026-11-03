import type { MatchState } from "./types";

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

export function inningsHeadline(state: MatchState, inningsNumber: 1 | 2): string | null {
  const innings = state.innings.find((item) => item.innings_number === inningsNumber);
  if (!innings) {
    return null;
  }
  const name = state.teams.find((team) => team.id === innings.batting_team_id)?.name ?? innings.batting_team_id;
  return `${name} ${innings.runs}/${innings.wickets}`;
}
