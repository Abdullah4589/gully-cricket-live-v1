import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ScoreAction } from "../score";
import { colors } from "../theme";
import { Tap } from "./Tap";

interface ScoringKeypadProps {
  onScore: (action: ScoreAction) => void;
  disabled?: boolean;
}

type ExtraMode = "bye" | "leg_bye" | "no_ball" | null;

const RUNS = [0, 1, 2, 3, 4, 5, 6] as const;

export function ScoringKeypad({ onScore, disabled = false }: ScoringKeypadProps) {
  const [mode, setMode] = useState<ExtraMode>(null);

  function pressRuns(runs: number) {
    if (disabled) {
      return;
    }
    if (mode === "bye") {
      onScore({ type: "bye", runs });
      setMode(null);
      return;
    }
    if (mode === "leg_bye") {
      onScore({ type: "leg_bye", runs });
      setMode(null);
      return;
    }
    if (mode === "no_ball") {
      onScore({ type: "no_ball", runsBat: runs });
      setMode(null);
      return;
    }
    onScore({ type: "runs", runs });
  }

  function pressWide() {
    if (disabled) {
      return;
    }
    setMode(null);
    onScore({ type: "wide" });
  }

  const prompt =
    mode === "bye"
      ? "Byes — pick how many."
      : mode === "leg_bye"
        ? "Leg-byes — pick how many."
        : mode === "no_ball"
          ? "No-ball — bat runs, 0 if they missed."
          : null;

  return (
    <View style={styles.wrap}>
      {prompt ? <Text style={styles.prompt}>{prompt}</Text> : null}
      <View style={styles.row}>
        {RUNS.slice(0, 4).map((runs) => (
          <Tap key={runs} label={String(runs)} testID={`score-${runs}`} disabled={disabled} onPress={() => pressRuns(runs)} />
        ))}
      </View>
      <View style={styles.row}>
        {RUNS.slice(4).map((runs) => (
          <Tap key={runs} label={String(runs)} testID={`score-${runs}`} disabled={disabled} onPress={() => pressRuns(runs)} />
        ))}
        <Tap label="Wide" testID="score-wide" tone="amber" disabled={disabled} onPress={pressWide} />
      </View>
      <View style={styles.row}>
        <Tap
          label="No-ball"
          testID="score-noball"
          tone="amber"
          disabled={disabled}
          selected={mode === "no_ball"}
          onPress={() => setMode((current) => (current === "no_ball" ? null : "no_ball"))}
        />
        <Tap
          label="Bye"
          testID="score-bye"
          disabled={disabled}
          selected={mode === "bye"}
          onPress={() => setMode((current) => (current === "bye" ? null : "bye"))}
        />
        <Tap
          label="Leg-bye"
          testID="score-legbye"
          disabled={disabled}
          selected={mode === "leg_bye"}
          onPress={() => setMode((current) => (current === "leg_bye" ? null : "leg_bye"))}
        />
      </View>
      <Tap
        label="Wicket"
        testID="score-wicket"
        tone="clay"
        disabled={disabled}
        onPress={() => {
          if (!disabled) {
            setMode(null);
            onScore({ type: "wicket" });
          }
        }}
      />
      <View style={styles.undoGap} />
      <Tap
        label="Undo"
        testID="score-undo"
        tone="ghost"
        onPress={() => onScore({ type: "undo" })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  prompt: {
    color: colors.amber,
    fontSize: 16,
    fontWeight: "600",
  },
  undoGap: {
    height: 28,
  },
});
