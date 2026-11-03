import { Pressable, StyleSheet, Text } from "react-native";

import { colors, hit } from "../theme";

interface TapProps {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: "cream" | "amber" | "clay" | "ghost";
  disabled?: boolean;
  selected?: boolean;
}

export function Tap({ label, onPress, testID, tone = "cream", disabled = false, selected = false }: TapProps) {
  const ink = tone === "amber" || tone === "cream" ? colors.ink : colors.cream;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === "amber" && styles.amber,
        tone === "clay" && styles.clay,
        tone === "ghost" && styles.ghost,
        tone === "cream" && styles.cream,
        selected && styles.selected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.label, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: hit,
    minWidth: hit,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
  },
  cream: {
    backgroundColor: colors.cream,
  },
  amber: {
    backgroundColor: colors.amber,
  },
  clay: {
    backgroundColor: colors.clay,
  },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.cream,
  },
  selected: {
    borderWidth: 2,
    borderColor: colors.amber,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 17,
    fontWeight: "700",
  },
});
