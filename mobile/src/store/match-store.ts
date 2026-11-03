import { create } from "zustand";

import { loadMatch, readPublicSlug, scoreBall, startNextInnings, undoBall } from "../db/database";
import { isScoringError } from "../engine";
import type { InningsStart, LegalBallInput, MatchDocument, MatchState } from "../engine";
import { newId } from "../ids";
import type { ScoreAction, WicketInput } from "../score";
import { kickFlush } from "../sync/kick";

interface Crease {
  strikerId: string;
  nonStrikerId: string | null;
}

interface MatchStore {
  localId: string | null;
  doc: MatchDocument | null;
  state: MatchState | null;
  publicSlug: string | null;
  loading: boolean;
  error: string | null;
  pendingCrease: Crease | null;
  pendingBowlerId: string | null;
  load: (localId: string) => Promise<void>;
  refreshSlug: () => Promise<void>;
  setPendingCrease: (crease: Crease) => void;
  setPendingBowler: (bowlerId: string) => void;
  score: (action: Exclude<ScoreAction, { type: "wicket" } | { type: "undo" }>) => Promise<void>;
  undo: () => Promise<void>;
  confirmWicket: (wicket: WicketInput) => Promise<void>;
  startChase: (start: InningsStart) => Promise<void>;
}

export const useMatchStore = create<MatchStore>((set, get) => ({
  localId: null,
  doc: null,
  state: null,
  publicSlug: null,
  loading: false,
  error: null,
  pendingCrease: null,
  pendingBowlerId: null,

  async load(localId) {
    if (get().localId === localId && get().doc && !get().loading) {
      return;
    }
    set({ loading: true, error: null, localId, pendingCrease: null, pendingBowlerId: null });
    try {
      const loaded = await loadMatch(localId);
      set({
        doc: loaded.doc,
        state: loaded.state,
        publicSlug: loaded.publicSlug,
        loading: false,
      });
    } catch {
      set({ loading: false, error: "This match is not on the phone.", doc: null, state: null });
    }
  },

  async refreshSlug() {
    const localId = get().localId;
    if (!localId) {
      return;
    }
    const publicSlug = await readPublicSlug(localId);
    set({ publicSlug });
  },

  setPendingCrease(crease) {
    set({ pendingCrease: crease, error: null });
  },

  setPendingBowler(bowlerId) {
    set({ pendingBowlerId: bowlerId, error: null });
  },

  async score(action) {
    const input = legalInput(get(), actionToInput(action));
    await writeBall(set, get, input);
  },

  async undo() {
    const localId = get().localId;
    if (!localId) {
      return;
    }
    try {
      const loaded = await undoBall(localId);
      set({
        doc: loaded.doc,
        state: loaded.state,
        publicSlug: loaded.publicSlug,
        error: null,
        pendingCrease: null,
        pendingBowlerId: null,
      });
      void kickFlush(false).then(() => get().refreshSlug());
    } catch (error) {
      set({ error: explain(error) });
    }
  },

  async confirmWicket(wicket) {
    const input = legalInput(get(), {
      runsBat: wicket.runsBat,
      extraType: null,
      extraRuns: 0,
      wicketType: wicket.wicketType,
      dismissedId: wicket.dismissedId,
      fielderId: wicket.fielderId,
    });
    await writeBall(set, get, input);
  },

  async startChase(start) {
    const localId = get().localId;
    if (!localId) {
      return;
    }
    try {
      const loaded = await startNextInnings(localId, start);
      set({
        doc: loaded.doc,
        state: loaded.state,
        publicSlug: loaded.publicSlug,
        error: null,
        pendingCrease: null,
        pendingBowlerId: null,
      });
      void kickFlush(false).then(() => get().refreshSlug());
    } catch (error) {
      set({ error: explain(error) });
      throw error;
    }
  },
}));

interface Shot {
  runsBat: number;
  extraType: LegalBallInput["extraType"];
  extraRuns: number;
  wicketType: LegalBallInput["wicketType"];
  dismissedId: string | null;
  fielderId: string | null;
}

function actionToInput(action: Exclude<ScoreAction, { type: "wicket" } | { type: "undo" }>): Shot {
  switch (action.type) {
    case "runs":
      return { runsBat: action.runs, extraType: null, extraRuns: 0, wicketType: null, dismissedId: null, fielderId: null };
    case "wide":
      return { runsBat: 0, extraType: "wide", extraRuns: 0, wicketType: null, dismissedId: null, fielderId: null };
    case "no_ball":
      return { runsBat: action.runsBat, extraType: "no_ball", extraRuns: 0, wicketType: null, dismissedId: null, fielderId: null };
    case "bye":
      return { runsBat: 0, extraType: "bye", extraRuns: action.runs, wicketType: null, dismissedId: null, fielderId: null };
    case "leg_bye":
      return { runsBat: 0, extraType: "leg_bye", extraRuns: action.runs, wicketType: null, dismissedId: null, fielderId: null };
    default: {
      const unreachable: never = action;
      throw new Error(`unexpected_action:${JSON.stringify(unreachable)}`);
    }
  }
}

function legalInput(store: MatchStore, shot: Shot): LegalBallInput {
  const state = store.state;
  if (!state || !state.striker_id || !state.bowler_id) {
    throw new Error("crease_not_ready");
  }
  const crease = store.pendingCrease;
  return {
    clientUuid: newId(),
    strikerId: crease?.strikerId ?? state.striker_id,
    nonStrikerId: crease ? crease.nonStrikerId : state.non_striker_id,
    bowlerId: store.pendingBowlerId ?? state.bowler_id,
    runsBat: shot.runsBat,
    extraType: shot.extraType,
    extraRuns: shot.extraRuns,
    wicketType: shot.wicketType,
    dismissedId: shot.dismissedId,
    fielderId: shot.fielderId,
  };
}

async function writeBall(
  set: (partial: Partial<MatchStore>) => void,
  get: () => MatchStore,
  input: LegalBallInput,
): Promise<void> {
  const localId = get().localId;
  if (!localId) {
    return;
  }
  try {
    const loaded = await scoreBall(localId, input);
    set({
      doc: loaded.doc,
      state: loaded.state,
      publicSlug: loaded.publicSlug,
      error: null,
      pendingCrease: null,
      pendingBowlerId: null,
    });
    void kickFlush(false).then(() => get().refreshSlug());
  } catch (error) {
    set({ error: explain(error) });
    throw error;
  }
}

function explain(error: unknown): string {
  if (isScoringError(error)) {
    if (error.code === "nothing_to_undo") {
      return "Nothing to undo.";
    }
    if (error.code === "innings_lineup") {
      return "That lineup does not match the toss.";
    }
    return error.code;
  }
  return "The book did not take that.";
}
