// Tiny shared primitives so every screen looks consistent without a UI kit.

import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors } from "../theme";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
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
  return <Text style={styles.h1}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
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
});
