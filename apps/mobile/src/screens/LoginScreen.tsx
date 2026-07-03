import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, themedStyles } from "../theme";
import { BACKEND, signInSupabase } from "../auth";
import { Button, Muted } from "../components/ui";

export default function LoginScreen({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const styles = getStyles();

  const submit = async () => {
    if (!email.trim()) return;
    if (BACKEND === "mock") {
      onSignIn(email.trim());
      return;
    }
    if (!password) {
      setNotice("Enter your password.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      onSignIn(await signInSupabase(email.trim(), password));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.logo}>SetFlow</Text>
      <Muted>Hands-free workouts for smart glasses</Muted>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {BACKEND === "supabase" && (
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
      )}
      <Button title={busy ? "Signing in..." : "Sign in"} onPress={submit} disabled={busy} />
      {notice ? <Text style={{ color: colors.red, fontSize: 13 }}>{notice}</Text> : null}
      <Muted>
        {BACKEND === "supabase"
          ? "Your SetFlow account - workouts sync across devices."
          : "Dev preview: any email works (mock auth)."}
      </Muted>
    </View>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  logo: { color: colors.text, fontSize: 34, fontWeight: "800" },
  input: {
    backgroundColor: colors.panel2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
}));
