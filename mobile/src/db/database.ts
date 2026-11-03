import * as SQLite from "expo-sqlite";

import {
  ScoringError,
  appendLegalBall,
  ballEvent,
  createMatch,
  deriveState,
  formatResult,
  peekUndoUuid,
  replayLog,
  startInnings,
  undoLastBall,
} from "../engine";
import type { BallEvent, InningsStart, LegalBallInput, MatchDocument, MatchState, Setup } from "../engine";
import { newId } from "../ids";
import type { OutboxRow, SyncRepository } from "../sync/types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS matches (
  local_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT,
  public_slug TEXT,
  scorer_token TEXT,
  setup_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS innings_starts (
  local_id TEXT NOT NULL,
  innings_number INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  PRIMARY KEY (local_id, innings_number)
);
CREATE TABLE IF NOT EXISTS balls (
  local_id TEXT NOT NULL,
  client_uuid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0,
  event_json TEXT NOT NULL,
  PRIMARY KEY (local_id, client_uuid)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_success_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER
);
INSERT OR IGNORE INTO sync_meta (id, last_success_at, last_error, last_error_at) VALUES (1, NULL, NULL, NULL);
`;

export interface MatchDefaults {
  overs: number;
  wideRuns: number;
  noBallRuns: number;
  lastManStands: boolean;
}

export interface MatchSummary {
  localId: string;
  title: string;
  score: string;
  updatedAt: number;
}

export interface LoadedMatch {
  localId: string;
  doc: MatchDocument;
  state: MatchState;
  publicSlug: string | null;
}

export interface SyncSnapshot {
  pending: number;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

const DEFAULTS: MatchDefaults = {
  overs: 5,
  wideRuns: 1,
  noBallRuns: 1,
  lastManStands: true,
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("gully.db").then(async (db) => {
      await db.execAsync(SCHEMA);
      return db;
    });
  }
  return databasePromise;
}

export async function listMatchSummaries(): Promise<MatchSummary[]> {
  const db = await initDb();
  const rows = await db.getAllAsync<{ local_id: string; updated_at: number }>(
    `SELECT local_id, updated_at FROM matches ORDER BY updated_at DESC`,
  );
  const summaries: MatchSummary[] = [];
  for (const row of rows) {
    const loaded = await readLoaded(db, row.local_id);
    summaries.push({
      localId: row.local_id,
      title: `${loaded.state.teams[0]?.name ?? "Side A"} vs ${loaded.state.teams[1]?.name ?? "Side B"}`,
      score: summaryScore(loaded.state),
      updatedAt: row.updated_at,
    });
  }
  return summaries;
}

export async function listLocalIds(): Promise<string[]> {
  const db = await initDb();
  const rows = await db.getAllAsync<{ local_id: string }>(`SELECT local_id FROM matches ORDER BY updated_at DESC`);
  return rows.map((row) => row.local_id);
}

export async function createAndStart(setup: Setup, start: InningsStart): Promise<string> {
  const doc = startInnings(createMatch(setup), start);
  const localId = newId();
  const now = Date.now();
  const payload = setupPayload(doc);
  const db = await initDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO matches (local_id, server_id, public_slug, scorer_token, setup_json, created_at, updated_at) VALUES (?, NULL, NULL, NULL, ?, ?, ?)`,
      localId,
      JSON.stringify(payload),
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO innings_starts (local_id, innings_number, body_json) VALUES (?, ?, ?)`,
      localId,
      start.innings_number,
      JSON.stringify(start),
    );
    await txn.runAsync(
      `INSERT INTO outbox (local_id, kind, payload_json, status, created_at) VALUES (?, 'create_match', ?, 'pending', ?)`,
      localId,
      JSON.stringify(payload),
      now,
    );
    await txn.runAsync(
      `INSERT INTO outbox (local_id, kind, payload_json, status, created_at) VALUES (?, 'start_innings', ?, 'pending', ?)`,
      localId,
      JSON.stringify(start),
      now + 1,
    );
  });
  return localId;
}

export async function loadMatch(localId: string): Promise<LoadedMatch> {
  const db = await initDb();
  return readLoaded(db, localId);
}

export async function readPublicSlug(localId: string): Promise<string | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<{ public_slug: string | null }>(
    `SELECT public_slug FROM matches WHERE local_id = ?`,
    localId,
  );
  return row?.public_slug ?? null;
}

export async function startNextInnings(localId: string, start: InningsStart): Promise<LoadedMatch> {
  const db = await initDb();
  const current = await readLoaded(db, localId);
  const next = startInnings(current.doc, start);
  const now = Date.now();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO innings_starts (local_id, innings_number, body_json) VALUES (?, ?, ?)`,
      localId,
      start.innings_number,
      JSON.stringify(start),
    );
    await txn.runAsync(
      `INSERT INTO outbox (local_id, kind, payload_json, status, created_at) VALUES (?, 'start_innings', ?, 'pending', ?)`,
      localId,
      JSON.stringify(start),
      now,
    );
    await txn.runAsync(`UPDATE matches SET updated_at = ? WHERE local_id = ?`, now, localId);
  });
  return { localId, doc: next, state: deriveState(next), publicSlug: current.publicSlug };
}

export async function scoreBall(localId: string, input: LegalBallInput): Promise<LoadedMatch> {
  const db = await initDb();
  const current = await readLoaded(db, localId);
  const next = appendLegalBall(current.doc, input);
  const stored = next.balls[next.balls.length - 1];
  if (!stored) {
    throw new Error("missing_ball");
  }
  const event = ballEvent(stored);
  const now = Date.now();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO balls (local_id, client_uuid, seq, voided, event_json) VALUES (?, ?, ?, 0, ?)`,
      localId,
      event.client_uuid,
      event.seq,
      JSON.stringify(event),
    );
    await txn.runAsync(
      `INSERT INTO outbox (local_id, kind, payload_json, status, created_at) VALUES (?, 'events', ?, 'pending', ?)`,
      localId,
      JSON.stringify(event),
      now,
    );
    await txn.runAsync(`UPDATE matches SET updated_at = ? WHERE local_id = ?`, now, localId);
  });
  return { localId, doc: next, state: deriveState(next), publicSlug: current.publicSlug };
}

export async function undoBall(localId: string): Promise<LoadedMatch> {
  const db = await initDb();
  const current = await readLoaded(db, localId);
  const clientUuid = peekUndoUuid(current.doc);
  if (clientUuid === null) {
    throw new ScoringError("nothing_to_undo");
  }
  const next = undoLastBall(current.doc);
  const now = Date.now();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`UPDATE balls SET voided = 1 WHERE local_id = ? AND client_uuid = ?`, localId, clientUuid);
    await txn.runAsync(
      `INSERT INTO outbox (local_id, kind, payload_json, status, created_at) VALUES (?, 'undo', ?, 'pending', ?)`,
      localId,
      JSON.stringify({ client_uuid: clientUuid }),
      now,
    );
    await txn.runAsync(`UPDATE matches SET updated_at = ? WHERE local_id = ?`, now, localId);
  });
  return { localId, doc: next, state: deriveState(next), publicSlug: current.publicSlug };
}

export async function readDefaults(): Promise<MatchDefaults> {
  const db = await initDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM settings WHERE key = 'defaults'`);
  if (!row) {
    return { ...DEFAULTS };
  }
  return parseDefaults(row.value);
}

export async function writeDefaults(defaults: MatchDefaults): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES ('defaults', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(defaults),
  );
}

export async function readSyncSnapshot(): Promise<SyncSnapshot> {
  const db = await initDb();
  const pending = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox WHERE status = 'pending'`,
  );
  const meta = await db.getFirstAsync<{ last_success_at: number | null; last_error: string | null; last_error_at: number | null }>(
    `SELECT last_success_at, last_error, last_error_at FROM sync_meta WHERE id = 1`,
  );
  return {
    pending: pending?.count ?? 0,
    lastSuccessAt: meta?.last_success_at ?? null,
    lastError: meta?.last_error ?? null,
    lastErrorAt: meta?.last_error_at ?? null,
  };
}

export function sqliteSyncRepository(): SyncRepository {
  return {
    async pending(localId) {
      const db = await initDb();
      const rows = await db.getAllAsync<{ id: number; local_id: string; kind: string; payload_json: string }>(
        `SELECT id, local_id, kind, payload_json FROM outbox WHERE local_id = ? AND status = 'pending' ORDER BY id ASC`,
        localId,
      );
      return rows.map(parseOutboxRow);
    },
    async ack(id) {
      const db = await initDb();
      await db.runAsync(`UPDATE outbox SET status = 'acked' WHERE id = ?`, id);
    },
    async noteError(code) {
      const db = await initDb();
      await db.runAsync(`UPDATE sync_meta SET last_error = ?, last_error_at = ? WHERE id = 1`, code, Date.now());
    },
    async noteSuccess() {
      const db = await initDb();
      await db.runAsync(`UPDATE sync_meta SET last_success_at = ?, last_error = NULL, last_error_at = NULL WHERE id = 1`, Date.now());
    },
    async identity(localId) {
      const db = await initDb();
      const row = await db.getFirstAsync<{ server_id: string | null; scorer_token: string | null }>(
        `SELECT server_id, scorer_token FROM matches WHERE local_id = ?`,
        localId,
      );
      return { serverId: row?.server_id ?? null, token: row?.scorer_token ?? null };
    },
    async saveCreated(localId, created) {
      const db = await initDb();
      await db.runAsync(
        `UPDATE matches SET server_id = ?, public_slug = ?, scorer_token = ? WHERE local_id = ?`,
        created.id,
        created.public_slug,
        created.scorer_token,
        localId,
      );
    },
  };
}

async function readLoaded(db: SQLite.SQLiteDatabase, localId: string): Promise<LoadedMatch> {
  const match = await db.getFirstAsync<{ setup_json: string; public_slug: string | null }>(
    `SELECT setup_json, public_slug FROM matches WHERE local_id = ?`,
    localId,
  );
  if (!match) {
    throw new Error("not_found");
  }
  const setup = parseSetup(match.setup_json);
  const inningsRows = await db.getAllAsync<{ body_json: string }>(
    `SELECT body_json FROM innings_starts WHERE local_id = ? ORDER BY innings_number ASC`,
    localId,
  );
  const ballRows = await db.getAllAsync<{ event_json: string; voided: number }>(
    `SELECT event_json, voided FROM balls WHERE local_id = ? ORDER BY seq ASC`,
    localId,
  );
  const doc = replayLog(
    setup,
    inningsRows.map((row) => parseInnings(row.body_json)),
    ballRows.map((row) => ({ event: parseBall(row.event_json), voided: row.voided === 1 })),
  );
  return { localId, doc, state: deriveState(doc), publicSlug: match.public_slug };
}

function setupPayload(doc: MatchDocument): Setup {
  return {
    overs: doc.overs,
    rules: { ...doc.rules },
    teams: doc.teams.map((team) => ({
      id: team.id,
      name: team.name,
      players: team.players.map((player) => ({ id: player.id, name: player.name })),
    })),
    toss_winner_team_id: doc.tossWinnerTeamId,
    toss_decision: doc.tossDecision,
  };
}

function summaryScore(state: MatchState): string {
  if (state.status === "complete") {
    return formatResult(state);
  }
  const live = state.innings[state.innings.length - 1];
  if (!live) {
    return "Not started";
  }
  const name = state.teams.find((team) => team.id === live.batting_team_id)?.name ?? "Batting";
  if (state.status === "innings_break") {
    return `${name} ${live.runs}/${live.wickets} · innings break`;
  }
  return `${name} ${live.runs}/${live.wickets} (${live.overs.display})`;
}

function parseOutboxRow(row: { id: number; local_id: string; kind: string; payload_json: string }): OutboxRow {
  const payload: unknown = JSON.parse(row.payload_json);
  if (row.kind === "create_match" && isSetup(payload)) {
    return { id: row.id, localId: row.local_id, kind: "create_match", payload };
  }
  if (row.kind === "start_innings" && isInnings(payload)) {
    return { id: row.id, localId: row.local_id, kind: "start_innings", payload };
  }
  if (row.kind === "events" && isBall(payload)) {
    return { id: row.id, localId: row.local_id, kind: "events", payload };
  }
  if (row.kind === "undo" && isRecord(payload) && typeof payload.client_uuid === "string") {
    return { id: row.id, localId: row.local_id, kind: "undo", payload: { client_uuid: payload.client_uuid } };
  }
  throw new Error("invalid_outbox");
}

function parseSetup(raw: string): Setup {
  const value: unknown = JSON.parse(raw);
  if (!isSetup(value)) {
    throw new Error("invalid_setup");
  }
  return value;
}

function parseInnings(raw: string): InningsStart {
  const value: unknown = JSON.parse(raw);
  if (!isInnings(value)) {
    throw new Error("invalid_innings");
  }
  return value;
}

function parseBall(raw: string) {
  const value: unknown = JSON.parse(raw);
  if (!isBall(value)) {
    throw new Error("invalid_ball");
  }
  return value;
}

function parseDefaults(raw: string): MatchDefaults {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    return { ...DEFAULTS };
  }
  const overs = typeof value.overs === "number" ? value.overs : DEFAULTS.overs;
  const wideRuns = typeof value.wideRuns === "number" ? value.wideRuns : DEFAULTS.wideRuns;
  const noBallRuns = typeof value.noBallRuns === "number" ? value.noBallRuns : DEFAULTS.noBallRuns;
  const lastManStands = typeof value.lastManStands === "boolean" ? value.lastManStands : DEFAULTS.lastManStands;
  return { overs, wideRuns, noBallRuns, lastManStands };
}

function isSetup(value: unknown): value is Setup {
  if (!isRecord(value) || typeof value.overs !== "number" || !Array.isArray(value.teams)) {
    return false;
  }
  if (value.toss_decision !== "bat" && value.toss_decision !== "bowl") {
    return false;
  }
  return typeof value.toss_winner_team_id === "string";
}

function isInnings(value: unknown): value is InningsStart {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.innings_number === 1 || value.innings_number === 2) &&
    typeof value.batting_team_id === "string" &&
    typeof value.bowling_team_id === "string" &&
    typeof value.striker_id === "string" &&
    typeof value.non_striker_id === "string" &&
    typeof value.opening_bowler_id === "string"
  );
}

function isBall(value: unknown): value is BallEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.client_uuid === "string" &&
    typeof value.seq === "number" &&
    (value.innings_number === 1 || value.innings_number === 2) &&
    typeof value.striker_id === "string" &&
    typeof value.bowler_id === "string" &&
    typeof value.runs_bat === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
