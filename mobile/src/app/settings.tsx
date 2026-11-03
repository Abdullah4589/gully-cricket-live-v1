import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Tap } from "../components/Tap";
import { readDefaults, readSyncSnapshot, writeDefaults } from "../db/database";
import type { MatchDefaults } from "../db/database";
import { kickFlush } from "../sync/kick";
import { colors, hit } from "../theme";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: readSyncSnapshot });
  const [overs, setOvers] = useState("5");
  const [wideRuns, setWideRuns] = useState("1");
  const [noBallRuns, setNoBallRuns] = useState("1");
  const [lastMan, setLastMan] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

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
      .catch(() => setNote("Defaults could not be read."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    const next: MatchDefaults = {
      overs: Number(overs),
      wideRuns: Number(wideRuns),
      noBallRuns: Number(noBallRuns),
      lastManStands: lastMan,
    };
    if (!Number.isInteger(next.overs) || next.overs < 1 || !Number.isInteger(next.wideRuns) || next.wideRuns < 1 || !Number.isInteger(next.noBallRuns) || next.noBallRuns < 1) {
      setNote("Use whole numbers above zero.");
      return;
    }
    await writeDefaults(next);
    setNote("Defaults saved. New matches will start from these.");
  }

  async function syncNow() {
    setSyncing(true);
    setNote(null);
    try {
      await kickFlush(true);
      await sync.refetch();
    } catch {
      setNote("Sync did not finish.");
    } finally {
      setSyncing(false);
    }
  }

  const pending = sync.data?.pending ?? 0;
  const lastSuccess = sync.data?.lastSuccessAt ? new Date(sync.data.lastSuccessAt).toLocaleString() : "Never";
  const lastError = sync.data?.lastError ?? "None";

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 28 }]}>
      <Text style={styles.section}>Default rules</Text>
      <Text style={styles.help}>These prefill a new match.</Text>
      <Labeled label="Overs" value={overs} onChangeText={setOvers} />
      <Labeled label="Wide runs" value={wideRuns} onChangeText={setWideRuns} />
      <Labeled label="No-ball runs" value={noBallRuns} onChangeText={setNoBallRuns} />
      <Tap label={lastMan ? "Last man stands: on" : "Last man stands: off"} tone={lastMan ? "amber" : "ghost"} onPress={() => setLastMan((value) => !value)} />
      <Tap label="Save defaults" tone="cream" onPress={() => void save()} />

      <Text style={styles.section}>Sync</Text>
      {sync.isPending ? <Text style={styles.help}>Checking the outbox…</Text> : null}
      {sync.isError ? <Text style={styles.error}>Sync status could not be read.</Text> : null}
      <Text style={styles.line} testID="pending-count">
        Pending: {pending}
      </Text>
      <Text style={styles.line}>Last success: {lastSuccess}</Text>
      <Text style={styles.line}>Last error: {lastError}</Text>
      <Tap label={syncing ? "Syncing…" : "Sync now"} testID="sync-now" tone="amber" disabled={syncing} onPress={() => void syncNow()} />
      {note ? <Text style={styles.help}>{note}</Text> : null}
      <Text style={styles.footer}>Built by Abdullah · Karachi</Text>
    </ScrollView>
  );
}

function Labeled({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.help}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  section: { color: colors.cream, fontSize: 22, fontWeight: "800", marginTop: 8 },
  help: { color: colors.muted, fontSize: 15 },
  line: { color: colors.cream, fontSize: 17 },
  error: { color: colors.clay, fontSize: 16 },
  field: { gap: 6 },
  input: {
    minHeight: hit,
    borderRadius: 12,
    backgroundColor: colors.card,
    color: colors.cream,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  footer: {
    color: colors.muted,
    textAlign: "center",
    marginTop: 28,
    fontSize: 14,
  },
});
