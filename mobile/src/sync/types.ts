import type { BallEvent, InningsStart, Setup } from "../engine";

export type OutboxRow =
  | { id: number; localId: string; kind: "create_match"; payload: Setup }
  | { id: number; localId: string; kind: "start_innings"; payload: InningsStart }
  | { id: number; localId: string; kind: "events"; payload: BallEvent }
  | { id: number; localId: string; kind: "undo"; payload: { client_uuid: string } };

export interface ServerIdentity {
  serverId: string | null;
  token: string | null;
}

export interface CreatedMatch {
  id: string;
  public_slug: string;
  scorer_token: string;
}

export interface SyncRepository {
  pending(localId: string): Promise<OutboxRow[]>;
  ack(id: number): Promise<void>;
  noteError(code: string): Promise<void>;
  noteSuccess(): Promise<void>;
  identity(localId: string): Promise<ServerIdentity>;
  saveCreated(localId: string, created: CreatedMatch): Promise<void>;
}

export interface FlushResult {
  acked: number;
  error: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
