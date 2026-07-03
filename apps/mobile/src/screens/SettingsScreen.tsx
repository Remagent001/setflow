import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { getSyncStatus, subscribeSyncStatus } from "../api";
import { Button, Card, H1, Muted } from "../components/ui";

/** Live "is my data safe" line (Segment 17 acceptance: user sees sync status). */
function SyncStatusLine() {
  const [, force] = useState(0);
  useEffect(() => subscribeSyncStatus(() => force((n) => n + 1)), []);
  const { pendingWrites, lastSavedAt } = getSyncStatus();
  return (
    <Muted>
      {pendingWrites > 0
        ? "Saving..."
        : lastSavedAt
          ? `All changes saved on this phone (${new Date(lastSavedAt).toLocaleTimeString()}).`
          : "All changes saved on this phone."}
      {" "}Cloud sync arrives with accounts.
    </Muted>
  );
}

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
        <Muted>YOUR DATA</Muted>
        <SyncStatusLine />
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
