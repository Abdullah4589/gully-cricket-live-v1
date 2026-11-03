import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Tap } from "../../../components/Tap";
import type { WicketType } from "../../../engine";
import type { WicketInput } from "../../../score";
import { useMatchStore } from "../../../store/match-store";
import { colors } from "../../../theme";

const TYPES: { type: Exclude<WicketType, null>; label: string; fielder: boolean }[] = [
  { type: "bowled", label: "Bowled", fielder: false },
  { type: "caught", label: "Caught", fielder: true },
  { type: "run_out", label: "Run out", fielder: true },
  { type: "stumped", label: "Stumped", fielder: true },
  { type: "lbw", label: "LBW", fielder: false },
  { type: "hit_wicket", label: "Hit wicket", fielder: false },
];

export default function WicketScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const localId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const insets = useSafeAreaInsets();
  const doc = useMatchStore((store) => store.doc);
  const state = useMatchStore((store) => store.state);
  const load = useMatchStore((store) => store.load);
  const pendingCrease = useMatchStore((store) => store.pendingCrease);
  const confirmWicket = useMatchStore((store) => store.confirmWicket);
  const [kind, setKind] = useState<Exclude<WicketType, null> | null>(null);
  const [fielderId, setFielderId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (localId) {
      void load(localId);
    }
  }, [load, localId]);

  if (!doc || !state || (state.status !== "innings_1" && state.status !== "innings_2")) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>The innings is not live.</Text>
      </View>
    );
  }

  const strikerId = pendingCrease?.strikerId ?? state.striker_id;
  const nonStrikerId = pendingCrease ? pendingCrease.nonStrikerId : state.non_striker_id;
  const bowlingId = state.innings.find((innings) => !innings.complete)?.bowling_team_id ?? state.innings[state.innings.length - 1]?.bowling_team_id;
  const fielders = doc.teams.find((team) => team.id === bowlingId)?.players ?? [];
  const chosen = TYPES.find((item) => item.type === kind) ?? null;
  const needsFielder = chosen?.fielder ?? false;
  const who = kind === "run_out" ? dismissedId : strikerId;

  async function save() {
    if (!kind || !who) {
      setError("Pick the dismissal.");
      return;
    }
    if (needsFielder && !fielderId) {
      setError("Pick the fielder.");
      return;
    }
    const input: WicketInput = {
      wicketType: kind,
      dismissedId: who,
      fielderId: needsFielder ? fielderId : null,
      runsBat: runs,
    };
    try {
      await confirmWicket(input);
      router.back();
    } catch {
      setError("That wicket was not accepted.");
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.title}>How?</Text>
      <View style={styles.grid}>
        {TYPES.map((item) => (
          <Tap key={item.type} label={item.label} testID={`wicket-${item.type}`} tone="clay" selected={kind === item.type} onPress={() => setKind(item.type)} />
        ))}
      </View>
      {kind === "run_out" ? (
        <View style={styles.block}>
          <Text style={styles.title}>Who is out?</Text>
          {strikerId ? <Tap label={`${nameOf(doc, strikerId)} (striker)`} selected={dismissedId === strikerId} onPress={() => setDismissedId(strikerId)} /> : null}
          {nonStrikerId ? (
            <Tap label={`${nameOf(doc, nonStrikerId)} (non-striker)`} selected={dismissedId === nonStrikerId} onPress={() => setDismissedId(nonStrikerId)} />
          ) : null}
        </View>
      ) : null}
      {needsFielder ? (
        <View style={styles.block}>
          <Text style={styles.title}>Fielder</Text>
          {fielders.map((player) => (
            <Tap key={player.id} label={player.name} selected={fielderId === player.id} onPress={() => setFielderId(player.id)} />
          ))}
        </View>
      ) : null}
      <Text style={styles.title}>Runs on the ball</Text>
      <View style={styles.grid}>
        {[0, 1, 2, 3, 4, 5, 6].map((value) => (
          <Tap key={value} label={String(value)} tone="cream" selected={runs === value} onPress={() => setRuns(value)} />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Tap label="Confirm wicket" testID="wicket-confirm" tone="clay" onPress={() => void save()} />
    </ScrollView>
  );
}

function nameOf(doc: NonNullable<ReturnType<typeof useMatchStore.getState>["doc"]>, id: string): string {
  for (const team of doc.teams) {
    const player = team.players.find((item) => item.id === id);
    if (player) {
      return player.name;
    }
  }
  return id;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { color: colors.cream, fontSize: 20, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  block: { gap: 8 },
  muted: { color: colors.muted, fontSize: 16 },
  error: { color: colors.clay, fontSize: 16 },
});
