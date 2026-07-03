import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, themedStyles } from "../theme";
import { Button, Muted } from "../components/ui";

export default function LoginScreen({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const styles = getStyles();

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
      <Button title="Sign in" onPress={() => email.trim() && onSignIn(email.trim())} />
      <Muted>Dev preview: any email works (mock auth).</Muted>
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
