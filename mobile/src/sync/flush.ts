import type { CreatedMatch, FetchLike, FlushResult, OutboxRow, SyncRepository } from "./types";

export interface FlushOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

/**
 * Flush one match's outbox in order: create_match, start_innings, events, undo.
 * A duplicate event ack does not touch the local ball log. A failed undo stops
 * this match's queue and leaves the row in place.
 */
export async function flushMatchQueue(
  repo: SyncRepository,
  localId: string,
  options: FlushOptions,
): Promise<FlushResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  let rows: OutboxRow[];
  try {
    rows = await repo.pending(localId);
  } catch {
    await repo.noteError("invalid_request");
    return { acked: 0, error: "invalid_request" };
  }

  let acked = 0;
  for (const row of rows) {
    let outcome: { ok: true } | { ok: false; error: string };
    try {
      outcome = await sendRow(repo, row, fetchImpl, base);
    } catch {
      outcome = { ok: false, error: "network" };
    }
    if (!outcome.ok) {
      await repo.noteError(outcome.error);
      return { acked, error: outcome.error };
    }
    await repo.ack(row.id);
    acked += 1;
  }
  await repo.noteSuccess();
  return { acked, error: null };
}

async function sendRow(
  repo: SyncRepository,
  row: OutboxRow,
  fetchImpl: FetchLike,
  base: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (row.kind === "create_match") {
    const response = await fetchImpl(`${base}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(row.payload),
    });
    const body = await readJson(response);
    if (response.status !== 201) {
      return { ok: false, error: errorCode(body, response.status) };
    }
    const created = parseCreated(body);
    if (!created) {
      return { ok: false, error: "invalid_request" };
    }
    await repo.saveCreated(row.localId, created);
    return { ok: true };
  }

  const identity = await repo.identity(row.localId);
  if (!identity.serverId || !identity.token) {
    return { ok: false, error: "match_not_created" };
  }
  const matchPath = `${base}/matches/${encodeURIComponent(identity.serverId)}`;

  if (row.kind === "start_innings") {
    const response = await fetchImpl(`${matchPath}/innings`, {
      method: "POST",
      headers: authHeaders(identity.token),
      body: JSON.stringify(row.payload),
    });
    const body = await readJson(response);
    if (response.status !== 200) {
      return { ok: false, error: errorCode(body, response.status) };
    }
    return { ok: true };
  }

  if (row.kind === "events") {
    const response = await fetchImpl(`${matchPath}/events`, {
      method: "POST",
      headers: authHeaders(identity.token),
      body: JSON.stringify({ events: [row.payload] }),
    });
    const body = await readJson(response);
    if (response.status === 409 || response.status === 422 || !response.ok) {
      return { ok: false, error: errorCode(body, response.status) };
    }
    if (!eventAcked(body, row.payload.client_uuid)) {
      return { ok: false, error: "invalid_request" };
    }
    return { ok: true };
  }

  const response = await fetchImpl(`${matchPath}/events/undo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${identity.token}`, Accept: "application/json" },
  });
  const body = await readJson(response);
  if (response.status === 200) {
    if (isRecord(body) && body.voided_client_uuid === row.payload.client_uuid) {
      return { ok: true };
    }
    return { ok: false, error: "undo_mismatch" };
  }
  if (response.status === 409 && isRecord(body) && body.error === "nothing_to_undo") {
    const shown = await getShowsVoided(fetchImpl, matchPath, identity.token, row.payload.client_uuid);
    if (shown) {
      return { ok: true };
    }
    return { ok: false, error: "nothing_to_undo" };
  }
  return { ok: false, error: errorCode(body, response.status) };
}

async function getShowsVoided(fetchImpl: FetchLike, matchPath: string, token: string, clientUuid: string): Promise<boolean> {
  const response = await fetchImpl(matchPath, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    return false;
  }
  return jsonShowsVoided(await readJson(response), clientUuid);
}

function jsonShowsVoided(value: unknown, clientUuid: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => jsonShowsVoided(item, clientUuid));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value.client_uuid === clientUuid && value.voided === true) {
    return true;
  }
  if (Array.isArray(value.voided_client_uuids) && value.voided_client_uuids.includes(clientUuid)) {
    return true;
  }
  return Object.values(value).some((item) => jsonShowsVoided(item, clientUuid));
}

function eventAcked(body: unknown, clientUuid: string): boolean {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return false;
  }
  return body.results.some((item) => {
    if (!isRecord(item)) {
      return false;
    }
    return item.client_uuid === clientUuid && (item.status === "applied" || item.status === "duplicate");
  });
}

function parseCreated(body: unknown): CreatedMatch | null {
  if (!isRecord(body)) {
    return null;
  }
  const { id, public_slug, scorer_token } = body;
  if (typeof id !== "string" || typeof public_slug !== "string" || typeof scorer_token !== "string") {
    return null;
  }
  if (id.length === 0 || public_slug.length === 0 || scorer_token.length === 0) {
    return null;
  }
  return { id, public_slug, scorer_token };
}

function errorCode(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }
  return `http_${status}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
