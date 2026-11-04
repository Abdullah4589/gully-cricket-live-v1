import { flushMatchQueue } from "./flush";
import type { BallEvent, InningsStart, Setup } from "../engine";
import type { CreatedMatch, OutboxRow, SyncRepository } from "./types";

const setup: Setup = {
  overs: 2,
  rules: { wide_runs: 1, no_ball_runs: 1, last_man_stands: true },
  teams: [
    {
      id: "team-a",
      name: "North End",
      players: [
        { id: "a1", name: "Adeel" },
        { id: "a2", name: "Bilal" },
      ],
    },
    {
      id: "team-b",
      name: "South End",
      players: [
        { id: "b1", name: "Chand" },
        { id: "b2", name: "Danish" },
      ],
    },
  ],
  toss_winner_team_id: "team-a",
  toss_decision: "bat",
};

const innings: InningsStart = {
  innings_number: 1,
  batting_team_id: "team-a",
  bowling_team_id: "team-b",
  striker_id: "a1",
  non_striker_id: "a2",
  opening_bowler_id: "b1",
};

const ball: BallEvent = {
  client_uuid: "00000000-0000-4000-8000-000000000001",
  seq: 1,
  innings_number: 1,
  striker_id: "a1",
  non_striker_id: "a2",
  bowler_id: "b1",
  runs_bat: 1,
  extra_type: null,
  extra_runs: 0,
  wicket_type: null,
  dismissed_id: null,
  fielder_id: null,
  over_index: 0,
  ball_in_over: 1,
};

interface Memory extends SyncRepository {
  rows: OutboxRow[];
  balls: string[];
  applyCalls: number;
  errors: string[];
  successes: number;
  created: CreatedMatch | null;
}

function memory(rows: OutboxRow[], identity: { serverId: string | null; token: string | null } = { serverId: null, token: null }): Memory {
  const repo: Memory = {
    rows: rows.map((row) => ({ ...row })),
    balls: ["00000000-0000-4000-8000-000000000001"],
    applyCalls: 0,
    errors: [],
    successes: 0,
    created: identity.serverId && identity.token ? { id: identity.serverId, public_slug: "slug-public", scorer_token: identity.token } : null,
    async pending(localId) {
      return repo.rows.filter((row) => row.localId === localId && row.id > 0);
    },
    async ack(id) {
      repo.rows = repo.rows.filter((row) => row.id !== id);
    },
    async noteError(code) {
      repo.errors.push(code);
    },
    async noteSuccess() {
      repo.successes += 1;
    },
    async identity() {
      return { serverId: repo.created?.id ?? null, token: repo.created?.scorer_token ?? null };
    },
    async saveCreated(_localId, created) {
      repo.created = created;
    },
  };
  return repo;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("outbox flush", () => {
  it("sends create, then innings, then events", async () => {
    const calls: string[] = [];
    const repo = memory([
      { id: 1, localId: "local", kind: "create_match", payload: setup },
      { id: 2, localId: "local", kind: "start_innings", payload: innings },
      { id: 3, localId: "local", kind: "events", payload: ball },
    ]);
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      if (input.endsWith("/matches") && init?.method === "POST") {
        return jsonResponse(201, { id: "server-1", public_slug: "north-south", scorer_token: "scorer-token-value" });
      }
      if (input.endsWith("/innings")) {
        return jsonResponse(200, { status: "innings_1" });
      }
      return jsonResponse(200, { results: [{ client_uuid: ball.client_uuid, status: "applied", seq: 1 }], state: {} });
    };

    const result = await flushMatchQueue(repo, "local", { baseUrl: "http://127.0.0.1:8000", fetchImpl });

    expect(result).toEqual({ acked: 3, error: null });
    expect(calls).toEqual([
      "POST http://127.0.0.1:8000/matches",
      "POST http://127.0.0.1:8000/matches/server-1/innings",
      "POST http://127.0.0.1:8000/matches/server-1/events",
    ]);
    expect(repo.created?.scorer_token).toBe("scorer-token-value");
    expect(repo.rows).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("scorer-token-value");
  });

  it("does not apply a ball again when the server acks a duplicate", async () => {
    const repo = memory([{ id: 4, localId: "local", kind: "events", payload: ball }], {
      serverId: "server-1",
      token: "scorer-token-value",
    });
    const before = [...repo.balls];
    const fetchImpl = async () =>
      jsonResponse(200, { results: [{ client_uuid: ball.client_uuid, status: "duplicate", seq: 1 }], state: {} });

    const result = await flushMatchQueue(repo, "local", { baseUrl: "http://127.0.0.1:8000", fetchImpl });

    expect(result.error).toBeNull();
    expect(repo.applyCalls).toBe(0);
    expect(repo.balls).toEqual(before);
    expect(repo.rows).toEqual([]);
  });

  it("stops the queue when undo voids a different ball", async () => {
    const calls: string[] = [];
    const repo = memory(
      [
        { id: 5, localId: "local", kind: "undo", payload: { client_uuid: ball.client_uuid } },
        { id: 6, localId: "local", kind: "events", payload: { ...ball, seq: 2, client_uuid: "00000000-0000-4000-8000-000000000002" } },
      ],
      { serverId: "server-1", token: "scorer-token-value" },
    );
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      return jsonResponse(200, { voided_client_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff", state: {} });
    };

    const result = await flushMatchQueue(repo, "local", { baseUrl: "http://127.0.0.1:8000", fetchImpl });

    expect(result.error).toBe("undo_mismatch");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/events/undo");
    expect(repo.rows.map((row) => row.kind)).toEqual(["undo", "events"]);
    expect(repo.balls).toEqual([ball.client_uuid]);
  });

  it("acks nothing_to_undo only when a GET shows that uuid already voided", async () => {
    const calls: string[] = [];
    const repo = memory(
      [
        { id: 7, localId: "local", kind: "undo", payload: { client_uuid: ball.client_uuid } },
        { id: 8, localId: "local", kind: "events", payload: { ...ball, seq: 2, client_uuid: "00000000-0000-4000-8000-000000000002" } },
      ],
      { serverId: "server-1", token: "scorer-token-value" },
    );
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      if (init?.method === "GET") {
        return jsonResponse(200, { events: [{ client_uuid: ball.client_uuid, voided: true }] });
      }
      if (input.endsWith("/undo")) {
        return jsonResponse(409, { error: "nothing_to_undo" });
      }
      return jsonResponse(200, { results: [{ client_uuid: "00000000-0000-4000-8000-000000000002", status: "applied", seq: 2 }] });
    };

    const result = await flushMatchQueue(repo, "local", { baseUrl: "http://127.0.0.1:8000", fetchImpl });

    expect(result).toEqual({ acked: 2, error: null });
    expect(calls.map((call) => call.split(" ").slice(0, 1).concat(call.includes("/undo") ? "undo" : call.endsWith("/events") ? "events" : "get").join(" "))).toEqual([
      "POST undo",
      "GET get",
      "POST events",
    ]);
  });

  it("keeps create, innings, and events queued when the API is down", async () => {
    const secondInnings: InningsStart = {
      innings_number: 2,
      batting_team_id: "team-b",
      bowling_team_id: "team-a",
      striker_id: "b1",
      non_striker_id: "b2",
      opening_bowler_id: "a1",
    };
    const repo = memory([
      { id: 9, localId: "local", kind: "create_match", payload: setup },
      { id: 10, localId: "local", kind: "start_innings", payload: innings },
      { id: 11, localId: "local", kind: "events", payload: ball },
      { id: 12, localId: "local", kind: "start_innings", payload: secondInnings },
    ]);
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };

    const result = await flushMatchQueue(repo, "local", {
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl,
    });

    expect(result).toEqual({ acked: 0, error: "network" });
    expect(repo.rows.map((row) => row.kind)).toEqual([
      "create_match",
      "start_innings",
      "events",
      "start_innings",
    ]);
    expect(repo.balls).toEqual([ball.client_uuid]);
  });
});
