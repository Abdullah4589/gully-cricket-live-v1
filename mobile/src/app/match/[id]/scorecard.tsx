import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Tap } from "../../../components/Tap";
import type { InningsView, MatchDocument } from "../../../engine";
import { useMatchStore } from "../../../store/match-store";
import { colors } from "../../../theme";

export default function ScorecardScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const localId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const insets = useSafeAreaInsets();
  const doc = useMatchStore((store) => store.doc);
  const state = useMatchStore((store) => store.state);
  const load = useMatchStore((store) => store.load);
  const [selected, setSelected] = useState<1 | 2 | null>(null);

  useEffect(() => {
    if (localId) {
      void load(localId);
    }
  }, [load, localId]);

  if (!doc || !state) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Opening the scorecard…</Text>
      </View>
    );
  }

  const preferred: 1 | 2 =
    state.innings.some((innings) => innings.innings_number === 2) && (state.status === "innings_2" || state.status === "complete")
      ? 2
      : 1;
  const current = selected ?? preferred;
  const innings = state.innings.find((item) => item.innings_number === current) ?? state.innings[0];
  if (!innings) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No innings yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.tabs}>
        {state.innings.map((item) => (
          <Tap
            key={item.innings_number}
            label={`${teamName(doc, item.batting_team_id)} ${item.runs}/${item.wickets}`}
            testID={`innings-tab-${item.innings_number}`}
            tone={item.innings_number === current ? "amber" : "ghost"}
            onPress={() => setSelected(item.innings_number)}
          />
        ))}
      </View>
      <InningsCard doc={doc} innings={innings} />
    </ScrollView>
  );
}

function InningsCard({ doc, innings }: { doc: MatchDocument; innings: InningsView }) {
  return (
    <View style={styles.block}>
      <Text style={styles.heading}>
        {teamName(doc, innings.batting_team_id)} {innings.runs}/{innings.wickets} ({innings.overs.display})
      </Text>
      <Text style={styles.section} testID="scorecard-batting">
        Batting
      </Text>
      {innings.batting.map((row) => (
        <View key={row.player_id} style={styles.line}>
          <View style={styles.who}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.meta}>{row.dismissal}</Text>
          </View>
          <Text style={styles.figures}>
            {row.runs} ({row.balls})
          </Text>
        </View>
      ))}
      <Text style={styles.section}>Bowling</Text>
      {innings.bowling.length === 0 ? <Text style={styles.meta}>No balls bowled.</Text> : null}
      {innings.bowling.map((row) => (
        <View key={row.player_id} style={styles.line}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={styles.figures}>
            {row.overs.display} · {row.maidens} · {row.runs} · {row.wickets}
          </Text>
        </View>
      ))}
      <Text style={styles.section}>Fall of wickets</Text>
      {innings.fall_of_wickets.length === 0 ? <Text style={styles.meta}>None yet.</Text> : null}
      {innings.fall_of_wickets.map((fall) => (
        <Text key={`${fall.wicket}-${fall.batter_id}`} style={styles.meta}>
          {fall.wicket}-{fall.runs} {playerName(doc, fall.batter_id)}
        </Text>
      ))}
      <Text style={styles.section}>Extras</Text>
      <Text style={styles.meta}>
        {innings.extras.total} (wd {innings.extras.wide}, nb {innings.extras.no_ball}, b {innings.extras.bye}, lb {innings.extras.leg_bye})
      </Text>
      <Text style={styles.section}>Over by over</Text>
      {innings.overs_timeline.length === 0 ? <Text style={styles.meta}>No balls yet.</Text> : null}
      {innings.overs_timeline.map((over, index) => (
        <Text key={`over-${index}`} style={styles.meta}>
          {index + 1}: {over.join(" ")}
        </Text>
      ))}
    </View>
  );
}

function teamName(doc: MatchDocument, id: string): string {
  return doc.teams.find((team) => team.id === id)?.name ?? id;
}

function playerName(doc: MatchDocument, id: string): string {
  for (const team of doc.teams) {
    const player = team.players.find((item) => item.id === id);
    if (player) {
      return player.name;
    }
  }
  return id;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 8 },
  block: { gap: 8 },
  heading: { color: colors.cream, fontSize: 28, fontWeight: "800" },
  section: { color: colors.amber, fontSize: 18, fontWeight: "800", marginTop: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" },
  who: { flex: 1 },
  name: { color: colors.cream, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 15 },
  figures: { color: colors.cream, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 16 },
});
