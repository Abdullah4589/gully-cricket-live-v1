import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HighlightCard } from "../../../components/HighlightCard";
import { Tap } from "../../../components/Tap";
import { apiBase, followLink } from "../../../sync/api";
import { useMatchStore } from "../../../store/match-store";
import { colors } from "../../../theme";

export default function ShareScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const localId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const insets = useSafeAreaInsets();
  const state = useMatchStore((store) => store.state);
  const slug = useMatchStore((store) => store.publicSlug);
  const load = useMatchStore((store) => store.load);
  const shot = useRef<ViewShotRef>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (localId) {
      void load(localId);
    }
  }, [load, localId]);

  const link = slug ? followLink(slug) : null;
  const board = useQuery({
    queryKey: ["public-score", slug],
    enabled: false,
    queryFn: async () => {
      const response = await fetch(`${apiBase()}/m/${slug}`);
      if (!response.ok) {
        throw new Error("public_board");
      }
      return response.json() as Promise<unknown>;
    },
  });

  async function copyLink() {
    if (!link) {
      setNote("The follow link will work after sync.");
      return;
    }
    await Clipboard.setStringAsync(link);
    setNote("Follow link copied.");
  }

  async function shareCard() {
    if (!shot.current) {
      return;
    }
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setNote("The share sheet is not available here.");
        return;
      }
      const uri = await shot.current.capture();
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share the card" });
    } catch {
      setNote("Couldn't open the share sheet on this device.");
    }
  }

  if (!state) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Opening the card…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
      <HighlightCard state={state} testID="highlight-card" />
      <ViewShot ref={shot} style={styles.offscreen} options={{ format: "png", quality: 1 }}>
        <View collapsable={false}>
          <HighlightCard state={state} />
        </View>
      </ViewShot>
      {link ? <Text style={styles.link}>{link}</Text> : <Text style={styles.muted}>The follow link will work after sync.</Text>}
      <Tap label="Copy follow link" testID="copy-follow" tone="amber" onPress={() => void copyLink()} />
      <Tap label="Share card" testID="share-card" tone="cream" onPress={() => void shareCard()} />
      {slug ? <Tap label="Refresh public score" tone="ghost" onPress={() => void board.refetch()} /> : null}
      {board.isFetching ? <Text style={styles.muted}>Checking the public board…</Text> : null}
      {board.isError ? <Text style={styles.error}>The public board did not answer.</Text> : null}
      {board.data ? <Text style={styles.muted}>Public: {readPublic(board.data)}</Text> : null}
      {note ? <Text style={styles.muted}>{note}</Text> : null}
    </ScrollView>
  );
}

function readPublic(value: unknown): string {
  if (typeof value !== "object" || value === null || !("innings" in value) || !Array.isArray(value.innings)) {
    return "unexpected reply";
  }
  const lines = value.innings.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("runs" in item) || !("wickets" in item)) {
      return [];
    }
    const runs = item.runs;
    const wickets = item.wickets;
    return typeof runs === "number" && typeof wickets === "number" ? [`${runs}/${wickets}`] : [];
  });
  return lines.length === 0 ? "no score yet" : lines.join(" · ");
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, alignItems: "flex-start" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  link: { color: colors.cream, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 16 },
  error: { color: colors.clay, fontSize: 16 },
  offscreen: { position: "absolute", left: -4000, top: 0 },
});
