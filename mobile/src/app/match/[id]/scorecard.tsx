import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Tap } from "../../../components/Tap";
import { formatEconomy, formatInningsRate, formatStrikeRate, formatToss, legalBalls } from "../../../engine";
import type { InningsView, MatchDocument, Partnership } from "../../../engine";
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
      <Text style={styles.meta} testID="toss-line">
        {formatToss(state)}
      </Text>
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
  const rate = formatInningsRate(innings.runs, legalBalls(innings.overs));
  return (
    <View style={styles.block}>
      <Text style={styles.heading}>
        {teamName(doc, innings.batting_team_id)} {innings.runs}/{innings.wickets} ({innings.overs.display})
        {rate ? `  CRR ${rate}` : ""}
      </Text>
      <Text style={styles.section} testID="scorecard-batting">
        Batting
      </Text>
      <View style={styles.line}>
        <View style={styles.who} />
        <Text style={styles.colHead}>R</Text>
        <Text style={styles.colHead}>B</Text>
        <Text style={styles.colHead}>4s</Text>
        <Text style={styles.colHead}>6s</Text>
        <Text style={styles.colHead}>SR</Text>
      </View>
      {innings.batting.map((row) => (
        <View key={row.player_id} style={styles.line} testID={`batter-${row.player_id}`}>
          <View style={styles.who}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.meta}>{row.dismissal}</Text>
          </View>
          <Text style={styles.col}>{row.runs}</Text>
          <Text style={styles.col}>{row.balls}</Text>
          <Text style={styles.col}>{row.fours}</Text>
          <Text style={styles.col}>{row.sixes}</Text>
          <Text style={styles.col}>{formatStrikeRate(row.runs, row.balls)}</Text>
        </View>
      ))}
      <Text style={styles.section}>Bowling</Text>
      <View style={styles.line}>
        <View style={styles.who} />
        <Text style={styles.colHead}>O</Text>
        <Text style={styles.colHead}>M</Text>
        <Text style={styles.colHead}>R</Text>
        <Text style={styles.colHead}>W</Text>
        <Text style={styles.colHead}>Econ</Text>
      </View>
      {innings.bowling.length === 0 ? <Text style={styles.meta}>No balls bowled.</Text> : null}
      {innings.bowling.map((row) => (
        <View key={row.player_id} style={styles.line} testID={`bowler-${row.player_id}`}>
          <View style={styles.who}>
            <Text style={styles.name}>{row.name}</Text>
          </View>
          <Text style={styles.col}>{row.overs.display}</Text>
          <Text style={styles.col}>{row.maidens}</Text>
          <Text style={styles.col}>{row.runs}</Text>
          <Text style={styles.col}>{row.wickets}</Text>
          <Text style={styles.col}>{formatEconomy(row.runs, legalBalls(row.overs))}</Text>
        </View>
      ))}
      <Text style={styles.section}>Fall of wickets</Text>
      {innings.fall_of_wickets.length === 0 ? <Text style={styles.meta}>None yet.</Text> : null}
      {innings.fall_of_wickets.map((fall) => (
        <Text key={`${fall.wicket}-${fall.batter_id}`} style={styles.meta}>
          {fall.wicket}-{fall.runs} {playerName(doc, fall.batter_id)}
        </Text>
      ))}
      <Text style={styles.section}>Partnerships</Text>
      {innings.partnerships.map((pair) => (
        <Text key={pair.wicket} style={styles.meta} testID={`partnership-${pair.wicket}`}>
          {partnershipText(doc, pair)}
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

function partnershipText(doc: MatchDocument, pair: Partnership): string {
  const first = `${playerName(doc, pair.batter1_id)} ${pair.batter1_runs} (${pair.batter1_balls})`;
  const second = pair.batter2_id === null ? "" : `, ${playerName(doc, pair.batter2_id)} ${pair.batter2_runs} (${pair.batter2_balls})`;
  return `${pair.wicket}  ${first}${second}  ${pair.runs} (${pair.balls})`;
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
  col: { color: colors.cream, width: 44, textAlign: "right", fontSize: 15, fontWeight: "700" },
  colHead: { color: colors.muted, width: 44, textAlign: "right", fontSize: 12, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 16 },
});
