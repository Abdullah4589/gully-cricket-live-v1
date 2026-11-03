import { StyleSheet, Text, View } from "react-native";

import { formatResult, inningsHeadline, topBatter, topBowler } from "../engine";
import type { MatchState } from "../engine";
import { colors } from "../theme";

export function HighlightCard({ state, testID }: { state: MatchState; testID?: string }) {
  const batter = topBatter(state);
  const bowler = topBowler(state);
  const first = inningsHeadline(state, 1);
  const second = inningsHeadline(state, 2);
  const live = state.innings[state.innings.length - 1];
  const liveName = live ? (state.teams.find((team) => team.id === live.batting_team_id)?.name ?? "Batting") : "";

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.kicker}>Gully Cricket Live</Text>
      <Text style={styles.teams}>
        {state.teams[0]?.name ?? "Side A"} vs {state.teams[1]?.name ?? "Side B"}
      </Text>
      {second && first ? (
        <View style={styles.scores}>
          <Text style={styles.score}>{first}</Text>
          <Text style={styles.score}>{second}</Text>
        </View>
      ) : (
        <Text style={styles.hero}>
          {live ? `${live.runs}/${live.wickets}` : "0/0"}
          {live ? <Text style={styles.overs}>  {live.overs.display}</Text> : null}
        </Text>
      )}
      {second && first ? null : <Text style={styles.side}>{liveName}</Text>}
      <Text style={styles.line}>{batter ? `${batter.name}  ${batter.runs} (${batter.balls})` : "No batter yet"}</Text>
      <Text style={styles.line}>{bowler ? `${bowler.name}  ${bowler.wickets}/${bowler.runs}` : "No bowler yet"}</Text>
      <Text style={styles.result}>{formatResult(state)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 320,
    backgroundColor: colors.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.amber,
    padding: 20,
    gap: 8,
  },
  kicker: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  teams: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: "700",
  },
  scores: {
    gap: 4,
  },
  score: {
    color: colors.cream,
    fontSize: 28,
    fontWeight: "800",
  },
  hero: {
    color: colors.cream,
    fontSize: 56,
    fontWeight: "800",
  },
  overs: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "600",
  },
  side: {
    color: colors.muted,
    fontSize: 16,
  },
  line: {
    color: colors.cream,
    fontSize: 16,
  },
  result: {
    color: colors.amber,
    fontSize: 20,
    fontWeight: "800",
    marginTop: 8,
  },
});
