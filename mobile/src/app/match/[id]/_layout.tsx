import { Stack } from "expo-router";

import { colors } from "../../../theme";

export default function MatchLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.cream,
        headerTitleStyle: { color: colors.cream, fontWeight: "700" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Scoring" }} />
      <Stack.Screen name="wicket" options={{ title: "Wicket" }} />
      <Stack.Screen name="scorecard" options={{ title: "Scorecard" }} />
      <Stack.Screen name="share" options={{ title: "Share" }} />
    </Stack>
  );
}
