import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { Button, Card, H1, Muted } from "../components/ui";

export default function SettingsScreen({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <H1>Settings</H1>
      <Card style={{ gap: 6 }}>
        <Muted>SIGNED IN AS</Muted>
        <Text style={styles.email}>{email}</Text>
      </Card>
      <Card style={{ gap: 6 }}>
        <Muted>COMING LATER</Muted>
        <Muted>Units (lb/kg) · timer presets (Segment 18) · privacy (Segment 20)</Muted>
      </Card>
      <Button title="Sign out" kind="quiet" onPress={onSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.bg },
  email: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
