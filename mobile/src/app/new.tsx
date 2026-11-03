import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Tap } from "../components/Tap";
import { createAndStart, readDefaults } from "../db/database";
import { battingTeamId, createMatch } from "../engine";
import type { InningsStart, Player, Setup, TossDecision } from "../engine";
import { newId } from "../ids";
import { kickFlush } from "../sync/kick";
import { colors, hit } from "../theme";

export default function NewMatchScreen() {
  const insets = useSafeAreaInsets();
  const [teamAId] = useState(newId);
  const [teamBId] = useState(newId);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [playersA, setPlayersA] = useState<Player[]>([]);
  const [playersB, setPlayersB] = useState<Player[]>([]);
  const [draftA, setDraftA] = useState("");
  const [draftB, setDraftB] = useState("");
  const [overs, setOvers] = useState("5");
  const [wideRuns, setWideRuns] = useState("1");
  const [noBallRuns, setNoBallRuns] = useState("1");
  const [lastMan, setLastMan] = useState(true);
  const [tossWinner, setTossWinner] = useState(teamAId);
  const [decision, setDecision] = useState<TossDecision>("bat");
  const [strikerId, setStrikerId] = useState<string | null>(null);
  const [nonStrikerId, setNonStrikerId] = useState<string | null>(null);
  const [bowlerId, setBowlerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readDefaults()
      .then((defaults) => {
        if (cancelled) {
          return;
        }
        setOvers(String(defaults.overs));
        setWideRuns(String(defaults.wideRuns));
        setNoBallRuns(String(defaults.noBallRuns));
        setLastMan(defaults.lastManStands);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const battingId = useMemo(() => {
    if (!tossWinner) {
      return null;
    }
    try {
      const doc = createMatch(draftSetup(teamAId, teamBId, teamA, teamB, playersA, playersB, 1, 1, 1, lastMan, tossWinner, decision));
      return battingTeamId(doc, 1);
    } catch {
      return null;
    }
  }, [decision, lastMan, playersA, playersB, teamA, teamAId, teamB, teamBId, tossWinner]);

  const batters = battingId === teamBId ? playersB : playersA;
  const bowlers = battingId === teamBId ? playersA : playersB;
  const striker = batters.some((player) => player.id === strikerId) ? strikerId : (batters[0]?.id ?? null);
  const nonStriker = batters.some((player) => player.id === nonStrikerId && player.id !== striker)
    ? nonStrikerId
    : (batters.find((player) => player.id !== striker)?.id ?? null);
  const bowler = bowlers.some((player) => player.id === bowlerId) ? bowlerId : (bowlers[0]?.id ?? null);

  function addPlayer(side: "a" | "b") {
    const name = (side === "a" ? draftA : draftB).trim();
    if (name.length === 0) {
      return;
    }
    const player = { id: newId(), name };
    if (side === "a") {
      setPlayersA((current) => [...current, player]);
      setDraftA("");
    } else {
      setPlayersB((current) => [...current, player]);
      setDraftB("");
    }
  }

  async function start() {
    const oversNum = Number(overs);
    const wideNum = Number(wideRuns);
    const noBallNum = Number(noBallRuns);
    if (teamA.trim().length === 0 || teamB.trim().length === 0) {
      setError("Each side needs a name.");
      return;
    }
    if (playersA.length < 2 || playersB.length < 2) {
      setError("Add at least two players to each side.");
      return;
    }
    if (!Number.isInteger(oversNum) || oversNum < 1 || !Number.isInteger(wideNum) || wideNum < 1 || !Number.isInteger(noBallNum) || noBallNum < 1) {
      setError("Overs, wides, and no-balls have to be whole numbers above zero.");
      return;
    }
    if (!tossWinner || !striker || !nonStriker || striker === nonStriker || !bowler || !battingId) {
      setError("Pick the toss, then the two openers and the opening bowler.");
      return;
    }
    const bowlingId = battingId === teamAId ? teamBId : teamAId;
    const setup: Setup = draftSetup(teamAId, teamBId, teamA.trim(), teamB.trim(), playersA, playersB, oversNum, wideNum, noBallNum, lastMan, tossWinner, decision);
    const startBody: InningsStart = {
      innings_number: 1,
      batting_team_id: battingId,
      bowling_team_id: bowlingId,
      striker_id: striker,
      non_striker_id: nonStriker,
      opening_bowler_id: bowler,
    };
    setSaving(true);
    setError(null);
    try {
      const localId = await createAndStart(setup, startBody);
      void kickFlush(false);
      router.replace(`/match/${localId}`);
    } catch {
      setError("That match could not be started.");
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        <Field label="Team A" testID="team-a-name" value={teamA} onChangeText={setTeamA} placeholder="North End" />
        <PlayerAdd
          inputId="player-a-input"
          addId="player-a-add"
          value={draftA}
          onChangeText={setDraftA}
          onAdd={() => addPlayer("a")}
          players={playersA}
        />
        <Field label="Team B" testID="team-b-name" value={teamB} onChangeText={setTeamB} placeholder="South End" />
        <PlayerAdd
          inputId="player-b-input"
          addId="player-b-add"
          value={draftB}
          onChangeText={setDraftB}
          onAdd={() => addPlayer("b")}
          players={playersB}
        />
        <View style={styles.row}>
          <Field label="Overs" testID="overs" value={overs} onChangeText={setOvers} keyboard="number-pad" />
          <Field label="Wide" testID="wide-runs" value={wideRuns} onChangeText={setWideRuns} keyboard="number-pad" />
          <Field label="No-ball" testID="noball-runs" value={noBallRuns} onChangeText={setNoBallRuns} keyboard="number-pad" />
        </View>
        <Tap
          label={lastMan ? "Last man stands: on" : "Last man stands: off"}
          testID="last-man"
          tone={lastMan ? "amber" : "ghost"}
          onPress={() => setLastMan((value) => !value)}
        />
        <Text style={styles.section}>Toss</Text>
        <View style={styles.row}>
          <Tap label={teamA.trim() || "Team A"} tone="cream" selected={tossWinner === teamAId} onPress={() => setTossWinner(teamAId)} />
          <Tap label={teamB.trim() || "Team B"} tone="cream" selected={tossWinner === teamBId} onPress={() => setTossWinner(teamBId)} />
        </View>
        <View style={styles.row}>
          <Tap label="Bat" tone="amber" selected={decision === "bat"} onPress={() => setDecision("bat")} />
          <Tap label="Bowl" tone="amber" selected={decision === "bowl"} onPress={() => setDecision("bowl")} />
        </View>
        <Text style={styles.section}>Innings 1</Text>
        <Text style={styles.hint}>Striker</Text>
        <ChipRow players={batters} selected={striker} onPick={setStrikerId} />
        <Text style={styles.hint}>Non-striker</Text>
        <ChipRow players={batters.filter((player) => player.id !== striker)} selected={nonStriker} onPick={setNonStrikerId} />
        <Text style={styles.hint}>Opening bowler</Text>
        <ChipRow players={bowlers} selected={bowler} onPick={setBowlerId} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Tap label={saving ? "Starting…" : "Start match"} testID="start-match" tone="amber" disabled={saving} onPress={() => void start()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function draftSetup(
  teamAId: string,
  teamBId: string,
  teamA: string,
  teamB: string,
  playersA: Player[],
  playersB: Player[],
  overs: number,
  wideRuns: number,
  noBallRuns: number,
  lastMan: boolean,
  tossWinner: string,
  decision: TossDecision,
): Setup {
  return {
    overs,
    rules: { wide_runs: wideRuns, no_ball_runs: noBallRuns, last_man_stands: lastMan },
    teams: [
      { id: teamAId, name: teamA || "Team A", players: playersA },
      { id: teamBId, name: teamB || "Team B", players: playersB },
    ],
    toss_winner_team_id: tossWinner,
    toss_decision: decision,
  };
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
  keyboard = "default",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  testID?: string;
  keyboard?: "default" | "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.hint}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboard}
        style={styles.input}
      />
    </View>
  );
}

function PlayerAdd({
  inputId,
  addId,
  value,
  onChangeText,
  onAdd,
  players,
}: {
  inputId: string;
  addId: string;
  value: string;
  onChangeText: (value: string) => void;
  onAdd: () => void;
  players: Player[];
}) {
  return (
    <View style={styles.players}>
      <View style={styles.row}>
        <TextInput
          testID={inputId}
          accessibilityLabel="Player name"
          value={value}
          onChangeText={onChangeText}
          placeholder="Player name"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.playerInput]}
          onSubmitEditing={onAdd}
        />
        <Tap label="Add" testID={addId} tone="amber" onPress={onAdd} />
      </View>
      <Text style={styles.names}>{players.length === 0 ? "Nobody added yet." : players.map((player) => player.name).join(", ")}</Text>
    </View>
  );
}

function ChipRow({ players, selected, onPick }: { players: Player[]; selected: string | null; onPick: (id: string) => void }) {
  if (players.length === 0) {
    return <Text style={styles.hint}>Add players first.</Text>;
  }
  return (
    <View style={styles.row}>
      {players.map((player) => (
        <Tap key={player.id} label={player.name} tone="cream" selected={player.id === selected} onPress={() => onPick(player.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 16, gap: 12 },
  field: { flex: 1, gap: 6 },
  hint: { color: colors.muted, fontSize: 14 },
  section: { color: colors.cream, fontSize: 20, fontWeight: "800", marginTop: 8 },
  input: {
    minHeight: hit,
    borderRadius: 12,
    backgroundColor: colors.card,
    color: colors.cream,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  playerInput: { flex: 1 },
  row: { flexDirection: "row", gap: 8 },
  players: { gap: 6 },
  names: { color: colors.cream, fontSize: 16 },
  error: { color: colors.clay, fontSize: 16 },
});
