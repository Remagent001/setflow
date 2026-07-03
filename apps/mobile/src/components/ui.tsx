// Tiny shared primitives so every screen looks consistent without a UI kit.

import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, themedStyles } from "../theme";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const styles = getStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "quiet" | "danger";
  disabled?: boolean;
}) {
  const styles = getStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === "quiet" && styles.btnQuiet,
        kind === "danger" && styles.btnDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          kind === "quiet" && { color: colors.text },
          kind === "danger" && { color: "#fff" },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={getStyles().h1}>{children}</Text>;
}

/** One-tap pick-one row: LABEL  [option] [option] [option] */
export function ChipRow<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  onSelect: (v: T) => void;
}) {
  const styles = getStyles();
  return (
    <View style={styles.chipRow}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chipOptions}>
        {options.map((o) => {
          const active = value === o;
          return (
            <Pressable
              key={o}
              onPress={() => onSelect(o)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={getStyles().muted}>{children}</Text>;
}

const getStyles = themedStyles(() => StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  btnQuiet: { backgroundColor: colors.panel2 },
  btnDanger: { backgroundColor: "#e5534b" },
  btnText: { color: colors.bg, fontWeight: "700", fontSize: 15 },
  h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13 },
  chipRow: { gap: 6 },
  chipLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextActive: { color: colors.bg, fontWeight: "700" },
}));
