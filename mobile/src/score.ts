import type { WicketType } from "./engine";

export type ScoreAction =
  | { type: "runs"; runs: number }
  | { type: "wide" }
  | { type: "no_ball"; runsBat: number }
  | { type: "bye"; runs: number }
  | { type: "leg_bye"; runs: number }
  | { type: "wicket" }
  | { type: "undo" };

export interface WicketInput {
  wicketType: Exclude<WicketType, null>;
  dismissedId: string;
  fielderId: string | null;
  runsBat: number;
}
