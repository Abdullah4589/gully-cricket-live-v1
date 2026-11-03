import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";

import { initDb } from "../db/database";
import { queryClient } from "../query";
import { kickFlush } from "../sync/kick";
import { colors } from "../theme";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void kickFlush(false);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void kickFlush(false);
      }
    });
    return () => appState.remove();
  }, [ready]);

  if (failed) {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootText}>The match book could not open.</Text>
      </View>
    );
  }
  if (!ready) {
    return <View style={styles.boot} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.cream,
          headerTitleStyle: { color: colors.cream, fontWeight: "700" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Gully Cricket" }} />
        <Stack.Screen name="new" options={{ title: "New match" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
      </Stack>
    </QueryClientProvider>
  );
}

const styles = {
  boot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
  },
  bootText: {
    color: colors.cream,
    fontSize: 18,
  },
};
