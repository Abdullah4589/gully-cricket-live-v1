import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScoringKeypad } from "../../../components/ScoringKeypad";
import { Tap } from "../../../components/Tap";
import { activeInnings, batterOptions, battingTeamId, bowlerOptions, formatEconomy, formatResult, formatStrikeRate, legalBalls, teamPlayers } from "../../../engine";
import type { InningsStart, InningsView, MatchDocument, Player } from "../../../engine";
import type { ScoreAction } from "../../../score";
import { useMatchStore } from "../../../store/match-store";
import { colors, hit } from "../../../theme";

export default function ScoringScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const localId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const insets = useSafeAreaInsets();
  const doc = useMatchStore((store) => store.doc);
  const state = useMatchStore((store) => store.state);
  const loading = useMatchStore((store) => store.loading);
  const error = useMatchStore((store) => store.error);
  const load = useMatchStore((store) => store.load);
  const undo = useMatchStore((store) => store.undo);
  const score = useMatchStore((store) => store.score);

  useEffect(() => {
    if (localId) {
      void load(localId);
    }
  }, [localId, load]);
  if (loading || !state || !doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error ?? "Opening the match…"}</Text>
      </View>
    );
  }

  function onScore(action: ScoreAction) {
    if (action.type === "wicket") {
      router.push(`/match/${localId}/wicket`);
      return;
    }
    if (action.type === "undo") {
      void undo();
      return;
    }
    void score(action).catch(() => undefined);
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.nav}>
        <Pressable testID="open-scorecard" accessibilityRole="button" style={styles.navButton} onPress={() => router.push(`/match/${localId}/scorecard`)}>
          <Text style={styles.navLabel}>Scorecard</Text>
        </Pressable>
        <Pressable testID="open-share" accessibilityRole="button" style={styles.navButton} onPress={() => router.push(`/match/${localId}/share`)}>
          <Text style={styles.navLabel}>Share</Text>
        </Pressable>
      </View>
      <ScoreBoard />
      {state.status === "innings_break" ? <InningsBreak /> : null}
      {state.status === "complete" ? (
        <View style={styles.block}>
          <Text style={styles.result}>{formatResult(state)}</Text>
          <Text style={styles.muted}>The book is closed.</Text>
        </View>
      ) : null}
      {state.status === "innings_1" || state.status === "innings_2" ? <LiveScoring onScore={onScore} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function ScoreBoard() {
  const state = useMatchStore((store) => store.state);
  const doc = useMatchStore((store) => store.doc);
  if (!state || !doc) {
    return null;
  }
  const number = activeInnings(state);
  const live = state.innings.find((innings) => innings.innings_number === number) ?? state.innings[state.innings.length - 1];
  const tokens = live?.overs_timeline[live.overs_timeline.length - 1] ?? [];
  return (
    <View style={styles.block}>
      <Text style={styles.teams}>
        {state.teams[0]?.name} vs {state.teams[1]?.name}
      </Text>
      {state.innings.map((innings) => (
        <Text key={innings.innings_number} style={innings.innings_number === number ? styles.score : styles.otherScore} testID={innings.innings_number === (number ?? state.innings.length) ? "score-total" : undefined}>
          {teamName(doc, innings.batting_team_id)} {innings.runs}/{innings.wickets}
          <Text style={styles.overs}>  {innings.overs.display}</Text>
        </Text>
      ))}
      {state.status === "innings_2" ? (
        <Text style={styles.rates} testID="live-rates">
          Need {state.runs_needed ?? 0} · CRR {showRate(state.crr)} · RRR {showRate(state.rrr)}
        </Text>
      ) : null}
      {state.status === "innings_1" && state.crr !== null ? (
        <Text style={styles.rates} testID="live-rates">
          CRR {showRate(state.crr)}
        </Text>
      ) : null}
      <Text style={styles.tokens}>{tokens.length === 0 ? "This over has not started." : tokens.join("  ")}</Text>
      {number && live ? (
        <View style={styles.crease} testID="crease">
          <Text style={styles.striker}>Striker  {playerName(doc, state.striker_id)}  {batterFigures(live, state.striker_id)}</Text>
          <Text style={styles.player}>
            Non-striker  {state.non_striker_id ? `${playerName(doc, state.non_striker_id)}  ${batterFigures(live, state.non_striker_id)}` : "batting alone"}
          </Text>
          <Text style={styles.player}>Bowler  {bowlerFigures(doc, live, state.bowler_id)}</Text>
          <Text style={styles.player}>Partnership  {partnershipFigures(live)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function LiveScoring({ onScore }: { onScore: (action: ScoreAction) => void }) {
  const doc = useMatchStore((store) => store.doc);
  const state = useMatchStore((store) => store.state);
  const pendingCrease = useMatchStore((store) => store.pendingCrease);
  const pendingBowlerId = useMatchStore((store) => store.pendingBowlerId);
  const setPendingCrease = useMatchStore((store) => store.setPendingCrease);
  const setPendingBowler = useMatchStore((store) => store.setPendingBowler);
  if (!doc || !state) {
    return null;
  }
  const batters = batterOptions(doc);
  const bowlers = bowlerOptions(doc);
  const ready = (!batters.required || pendingCrease !== null) && (!bowlers.required || pendingBowlerId !== null);

  return (
    <View style={styles.block}>
      {batters.required ? (
        <View style={styles.picker}>
          <Text style={styles.prompt}>{batters.end === "non_striker" ? "New non-striker" : "New striker"}</Text>
          {batters.forced ? (
            <Tap label="Last batter continues" tone="amber" onPress={() => { if (batters.forced) setPendingCrease(batters.forced); }} selected={pendingCrease !== null} />
          ) : (
            batters.options.map((player) => (
              <Tap
                key={player.id}
                label={player.name}
                tone="cream"
                selected={selectedBatter(batters.end, player.id, pendingCrease)}
                onPress={() => {
                  if (batters.end === "non_striker" && state.striker_id) {
                    setPendingCrease({ strikerId: state.striker_id, nonStrikerId: player.id });
                  } else if (state.non_striker_id !== undefined) {
                    setPendingCrease({ strikerId: player.id, nonStrikerId: state.non_striker_id });
                  }
                }}
              />
            ))
          )}
        </View>
      ) : null}
      {bowlers.required ? (
        <View style={styles.picker}>
          <Text style={styles.prompt}>End of the over. New bowler.</Text>
          {bowlers.options.map((player) => (
            <Tap key={player.id} label={player.name} tone="amber" selected={pendingBowlerId === player.id} onPress={() => setPendingBowler(player.id)} />
          ))}
        </View>
      ) : null}
      <ScoringKeypad onScore={onScore} disabled={!ready} />
    </View>
  );
}

function InningsBreak() {
  const doc = useMatchStore((store) => store.doc);
  const state = useMatchStore((store) => store.state);
  const startChase = useMatchStore((store) => store.startChase);
  if (!doc || !state || state.innings[0] === undefined) {
    return null;
  }
  const target = state.innings[0].runs + 1;
  const battingId = battingTeamId(doc, 2);
  const bowlingId = doc.teams.find((team) => team.id !== battingId)?.id ?? "";
  const batters = teamPlayers(doc, battingId);
  const bowlers = teamPlayers(doc, bowlingId);
  return <ChaseForm target={target} batters={batters} bowlers={bowlers} battingId={battingId} bowlingId={bowlingId} onStart={startChase} />;
}

function ChaseForm({
  target,
  batters,
  bowlers,
  battingId,
  bowlingId,
  onStart,
}: {
  target: number;
  batters: Player[];
  bowlers: Player[];
  battingId: string;
  bowlingId: string;
  onStart: (start: InningsStart) => Promise<void>;
}) {
  const striker = useMatchStore((store) => store.pendingCrease?.strikerId ?? batters[0]?.id ?? null);
  const nonStriker = useMatchStore((store) => store.pendingCrease?.nonStrikerId ?? batters.find((player) => player.id !== striker)?.id ?? null);
  const bowler = useMatchStore((store) => store.pendingBowlerId ?? bowlers[0]?.id ?? null);
  const setPendingCrease = useMatchStore((store) => store.setPendingCrease);
  const setPendingBowler = useMatchStore((store) => store.setPendingBowler);

  return (
    <View style={styles.block}>
      <Text style={styles.result}>Target {target}</Text>
      <Text style={styles.prompt}>Innings 2 openers</Text>
      <Text style={styles.muted}>Striker</Text>
      {batters.map((player) => (
        <Tap
          key={`s-${player.id}`}
          label={player.name}
          selected={striker === player.id}
          onPress={() => setPendingCrease({ strikerId: player.id, nonStrikerId: nonStriker === player.id ? null : nonStriker })}
        />
      ))}
      <Text style={styles.muted}>Non-striker</Text>
      {batters.filter((player) => player.id !== striker).map((player) => (
        <Tap
          key={`n-${player.id}`}
          label={player.name}
          selected={nonStriker === player.id}
          onPress={() => {
            if (striker) {
              setPendingCrease({ strikerId: striker, nonStrikerId: player.id });
            }
          }}
        />
      ))}
      <Text style={styles.muted}>Opening bowler</Text>
      {bowlers.map((player) => (
        <Tap key={`b-${player.id}`} label={player.name} tone="amber" selected={bowler === player.id} onPress={() => setPendingBowler(player.id)} />
      ))}
      <Tap
        label="Start chase"
        testID="start-chase"
        tone="amber"
        onPress={() => {
          if (!striker || !nonStriker || !bowler || striker === nonStriker) {
            return;
          }
          const start: InningsStart = {
            innings_number: 2,
            batting_team_id: battingId,
            bowling_team_id: bowlingId,
            striker_id: striker,
            non_striker_id: nonStriker,
            opening_bowler_id: bowler,
          };
          void onStart(start).catch(() => undefined);
        }}
      />
    </View>
  );
}

function selectedBatter(end: "striker" | "non_striker" | null, playerId: string, crease: { strikerId: string; nonStrikerId: string | null } | null): boolean {
  if (!crease) {
    return false;
  }
  return end === "non_striker" ? crease.nonStrikerId === playerId : crease.strikerId === playerId;
}

function playerName(doc: MatchDocument, id: string | null): string {
  if (!id) {
    return "—";
  }
  for (const team of doc.teams) {
    const player = team.players.find((item) => item.id === id);
    if (player) {
      return player.name;
    }
  }
  return id;
}

function teamName(doc: MatchDocument, id: string): string {
  return doc.teams.find((team) => team.id === id)?.name ?? id;
}

function showRate(value: number | null): string {
  return value === null ? "—" : String(value);
}

function batterFigures(innings: InningsView, playerId: string | null): string {
  const row = innings.batting.find((item) => item.player_id === playerId);
  const runs = row?.runs ?? 0;
  const balls = row?.balls ?? 0;
  return `${runs} (${balls})  SR ${formatStrikeRate(runs, balls)}`;
}

function bowlerFigures(doc: MatchDocument, innings: InningsView, bowlerId: string | null): string {
  const name = playerName(doc, bowlerId);
  const row = innings.bowling.find((item) => item.player_id === bowlerId);
  if (!row) {
    return `${name}  0.0-0-0-0  Econ -`;
  }
  const figures = `${row.overs.display}-${row.maidens}-${row.runs}-${row.wickets}`;
  return `${name}  ${figures}  Econ ${formatEconomy(row.runs, legalBalls(row.overs))}`;
}

function partnershipFigures(innings: InningsView): string {
  const pair = innings.partnerships[innings.partnerships.length - 1];
  if (!pair) {
    return "0 (0)";
  }
  return `${pair.runs} (${pair.balls})`;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  nav: { flexDirection: "row", gap: 8 },
  navButton: {
    flex: 1,
    minHeight: hit,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { color: colors.cream, fontSize: 16, fontWeight: "700" },
  block: { gap: 10 },
  teams: { color: colors.muted, fontSize: 16 },
  score: { color: colors.cream, fontSize: 64, fontWeight: "800", lineHeight: 72 },
  otherScore: { color: colors.muted, fontSize: 22, fontWeight: "700" },
  overs: { color: colors.amber, fontSize: 22, fontWeight: "700" },
  rates: { color: colors.cream, fontSize: 16 },
  tokens: { color: colors.amber, fontSize: 20, fontWeight: "700" },
  crease: { gap: 4 },
  striker: { color: colors.amber, fontSize: 18, fontWeight: "800" },
  player: { color: colors.cream, fontSize: 18 },
  prompt: { color: colors.cream, fontSize: 18, fontWeight: "800" },
  picker: { gap: 8 },
  result: { color: colors.amber, fontSize: 32, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 16 },
  error: { color: colors.clay, fontSize: 16 },
});
