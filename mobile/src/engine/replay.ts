import { ScoringError } from "./errors";
import { appendBall, createMatch, deriveState, startInnings, undoLastBall } from "./engine";
import type { BallEvent, InningsStart, MatchDocument, MatchState, Setup } from "./types";

export interface ReplayOpBall {
  op: "ball";
  event: BallEvent;
}

export interface ReplayOpUndo {
  op: "undo";
}

export type ReplayOp = ReplayOpBall | ReplayOpUndo;

export interface ReplayFixture {
  setup: Setup;
  innings: InningsStart[];
  ops: ReplayOp[];
  expect: MatchState;
}

export interface InvalidFixture extends ReplayFixture {
  illegal: ReplayOpBall;
  expect_error: string;
}

export interface LogEntry {
  event: BallEvent;
  voided: boolean;
}

/** Rebuild a phone log. Voided rows are appended and undone before the next ball. */
export function replayLog(setup: Setup, starts: readonly InningsStart[], entries: readonly LogEntry[]): MatchDocument {
  let doc = createMatch(setup);
  const byNumber = new Map(starts.map((start) => [start.innings_number, start]));
  for (const entry of entries) {
    doc = ensureStarted(doc, byNumber, entry.event.innings_number);
    doc = appendBall(doc, entry.event);
    if (entry.voided) {
      doc = undoLastBall(doc);
    }
  }
  for (const start of starts) {
    if (!doc.innings.some((innings) => innings.innings_number === start.innings_number)) {
      doc = startInnings(doc, start);
    }
  }
  return doc;
}

export function replayFixture(fixture: ReplayFixture): MatchState {
  return deriveState(replayOps(fixture));
}

export function runInvalidFixture(fixture: InvalidFixture): { code: string; state: MatchState; before: MatchState } {
  let doc = replayOps(fixture);
  const byNumber = new Map(fixture.innings.map((start) => [start.innings_number, start]));
  doc = ensureStarted(doc, byNumber, fixture.illegal.event.innings_number);
  const before = deriveState(doc);
  let code: string | null = null;
  try {
    const next = appendBall(doc, fixture.illegal.event);
    if (next !== doc) {
      throw new Error("illegal ball mutated the match");
    }
  } catch (error) {
    if (error instanceof ScoringError) {
      code = error.code;
    } else {
      throw error;
    }
  }
  if (code === null) {
    throw new Error("expected a scoring error");
  }
  return { code, state: deriveState(doc), before };
}

function replayOps(fixture: ReplayFixture): MatchDocument {
  let doc = createMatch(fixture.setup);
  const byNumber = new Map(fixture.innings.map((start) => [start.innings_number, start]));
  for (const op of fixture.ops) {
    if (op.op === "undo") {
      doc = undoLastBall(doc);
    } else {
      doc = ensureStarted(doc, byNumber, op.event.innings_number);
      doc = appendBall(doc, op.event);
    }
  }
  return doc;
}

function ensureStarted(
  doc: MatchDocument,
  starts: ReadonlyMap<1 | 2, InningsStart>,
  inningsNumber: 1 | 2,
): MatchDocument {
  if (doc.innings.some((innings) => innings.innings_number === inningsNumber)) {
    return doc;
  }
  const start = starts.get(inningsNumber);
  if (!start) {
    throw new ScoringError("innings_not_ready");
  }
  return startInnings(doc, start);
}
