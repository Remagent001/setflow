// Settings (Segment 20): theme, units, privacy, sounds, disclaimer.
// Privacy stance: voice capture is tap-to-start only, transcripts are
// optional, raw audio is never stored, and nothing ever listens on its own.

import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { colors, themedStyles } from "../theme";
import { getSyncStatus, subscribeSyncStatus } from "../api";
import { getSettings, subscribeSettings, updateSettings } from "../settings";
import { Button, Card, ChipRow, H1, Muted } from "../components/ui";

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

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  const styles = getStyles();
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, disabled && { color: colors.muted }]}>{label}</Text>
        {hint ? <Muted>{hint}</Muted> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

export default function SettingsScreen({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const [, force] = useState(0);
  useEffect(() => subscribeSettings(() => force((n) => n + 1)), []);
  const s = getSettings();
  const styles = getStyles();

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.wrap}>
      <H1>Settings</H1>

      <Card style={{ gap: 6 }}>
        <Muted>SIGNED IN AS</Muted>
        <Text style={styles.email}>{email}</Text>
      </Card>

      <Card style={{ gap: 12 }}>
        <Muted>APPEARANCE</Muted>
        <ChipRow
          label="Theme"
          options={["dark", "light"] as const}
          value={s.theme}
          onSelect={(v) => updateSettings({ theme: v })}
        />
      </Card>

      <Card style={{ gap: 12 }}>
        <Muted>TRAINING</Muted>
        <ChipRow
          label="Weight unit"
          options={["lb", "kg"] as const}
          value={s.weightUnit}
          onSelect={(v) => updateSettings({ weightUnit: v })}
        />
        <ToggleRow
          label="Demo video autoplay"
          hint="Play exercise demos automatically when a demo card opens."
          value={s.demoAutoplay}
          onChange={(v) => updateSettings({ demoAutoplay: v })}
        />
        <ToggleRow
          label="Audio cues"
          hint="Spoken/beep cues for set start and completion (arrives with audio support)."
          value={s.audioCues}
          onChange={(v) => updateSettings({ audioCues: v })}
        />
        <ToggleRow
          label="Rest timer sounds"
          value={s.restTimerSounds}
          onChange={(v) => updateSettings({ restTimerSounds: v })}
        />
      </Card>

      <Card style={{ gap: 12 }}>
        <Muted>PRIVACY</Muted>
        <ToggleRow
          label="Voice logging"
          hint="Show the Log-by-voice button. Capture only ever starts from your tap - nothing listens on its own."
          value={s.voiceLogging}
          onChange={(v) => updateSettings({ voiceLogging: v })}
        />
        <ToggleRow
          label="Store transcripts"
          hint="Keep the words you said on each saved set. Off = only the parsed numbers are kept."
          value={s.storeTranscripts}
          onChange={(v) => updateSettings({ storeTranscripts: v })}
        />
        <ToggleRow
          label="Store raw audio"
          hint="Permanently off by design. Your voice recordings are never saved."
          value={false}
          disabled
        />
      </Card>

      <Card style={{ gap: 10 }}>
        <Muted>HEALTH DISCLAIMER</Muted>
        <Muted>
          SetFlow logs and organizes your training. It does not provide medical, health, or
          fitness advice, and its numbers and insights are informational only. Consult a
          qualified professional before starting or changing an exercise program, and stop if
          something hurts.
        </Muted>
        {s.disclaimerAccepted ? (
          <Text style={{ color: colors.green, fontSize: 13, fontWeight: "600" }}>
            ✓ Acknowledged
          </Text>
        ) : (
          <Button title="I understand" onPress={() => updateSettings({ disclaimerAccepted: true })} />
        )}
      </Card>

      <Card style={{ gap: 6 }}>
        <Muted>YOUR DATA</Muted>
        <SyncStatusLine />
      </Card>

      <Button title="Sign out" kind="quiet" onPress={onSignOut} />
    </ScrollView>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  wrap: { padding: 20, gap: 14, paddingBottom: 40 },
  email: { color: colors.text, fontSize: 16, fontWeight: "600" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
}));
