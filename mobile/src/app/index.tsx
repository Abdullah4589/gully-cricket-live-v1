import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listMatchSummaries } from "../db/database";
import { colors, hit } from "../theme";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const matches = useQuery({
    queryKey: ["matches"],
    queryFn: listMatchSummaries,
  });

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 28 }]}>
      <Pressable testID="new-match" accessibilityRole="button" style={styles.primary} onPress={() => router.push("/new")}>
        <Text style={styles.primaryLabel}>New match</Text>
      </Pressable>

      {matches.isPending ? <Text style={styles.muted}>Opening the book…</Text> : null}
      {matches.isError ? <Text style={styles.error}>The match list could not be read.</Text> : null}

      {matches.data && matches.data.length === 0 ? (
        <Text style={styles.empty}>No matches yet. Start one before the light goes.</Text>
      ) : null}

      <View style={styles.list}>
        {matches.data?.map((match) => (
          <Pressable
            key={match.localId}
            accessibilityRole="button"
            style={styles.card}
            onPress={() => router.push(`/match/${match.localId}`)}
          >
            <Text style={styles.title}>{match.title}</Text>
            <Text style={styles.score}>{match.score}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable accessibilityRole="button" style={styles.settings} onPress={() => router.push("/settings")}>
        <Text style={styles.settingsLabel}>Settings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  primary: {
    minHeight: hit,
    backgroundColor: colors.amber,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
  },
  muted: {
    color: colors.muted,
    fontSize: 16,
  },
  error: {
    color: colors.clay,
    fontSize: 16,
  },
  empty: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "600",
    marginTop: 12,
  },
  list: {
    gap: 10,
  },
  card: {
    minHeight: hit,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "center",
    gap: 4,
  },
  title: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: "700",
  },
  score: {
    color: colors.amber,
    fontSize: 16,
  },
  settings: {
    minHeight: hit,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsLabel: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "700",
  },
});
