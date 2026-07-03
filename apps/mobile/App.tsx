// SetFlow mobile shell: mock auth + a deliberately simple hand-rolled
// navigator (three tabs + two pushed screens). A navigation library can
// replace this later without touching the screens.

import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors, getThemeMode, subscribeTheme, themedStyles } from "./src/theme";
import { initApi } from "./src/api";
import { initSettings } from "./src/settings";
import { restoreSession, signOutSupabase } from "./src/auth";
import LoginScreen from "./src/screens/LoginScreen";
import TodayScreen from "./src/screens/TodayScreen";
import WorkoutDetailScreen from "./src/screens/WorkoutDetailScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import SessionDetailScreen from "./src/screens/SessionDetailScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

type Tab = "today" | "history" | "settings";
type Pushed =
  | { name: "detail"; planId: string }
  | { name: "player"; planId: string }
  | { name: "session"; sessionId: string }
  | null;

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "today", label: "Today", icon: "▦" },
  { key: "history", label: "History", icon: "◷" },
  { key: "settings", label: "Settings", icon: "☰" },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [pushed, setPushed] = useState<Pushed>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  // Hydrate the offline store + settings (and any saved sign-in) first.
  useEffect(() => {
    Promise.all([initApi(), initSettings()]).then(async () => {
      const saved = await restoreSession();
      if (saved) setEmail(saved);
      setReady(true);
    });
  }, []);

  // Theme toggles re-render the whole tree (stylesheets rebuild on read).
  const [, bumpTheme] = useState(0);
  useEffect(() => subscribeTheme(() => bumpTheme((n) => n + 1)), []);
  const styles = getStyles();
  const statusBarStyle = getThemeMode() === "dark" ? ("light" as const) : ("dark" as const);

  if (!ready) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style={statusBarStyle} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>Loading your data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!email) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style={statusBarStyle} />
        <LoginScreen onSignIn={setEmail} />
      </SafeAreaView>
    );
  }

  let screen: React.ReactNode;
  if (pushed?.name === "detail") {
    screen = (
      <WorkoutDetailScreen
        planId={pushed.planId}
        onStart={() => setPushed({ name: "player", planId: pushed.planId })}
        onBack={() => setPushed(null)}
      />
    );
  } else if (pushed?.name === "player") {
    screen = (
      <PlayerScreen
        planId={pushed.planId}
        onExit={() => {
          setPushed(null);
          setHistoryRefresh((n) => n + 1);
          setTab("history");
        }}
        onMinimize={() => {
          setPushed(null);
          setTab("today");
        }}
      />
    );
  } else if (tab === "today") {
    screen = (
      <TodayScreen
        onOpenPlan={(planId) => setPushed({ name: "detail", planId })}
        onStartPlan={(planId) => setPushed({ name: "player", planId })}
      />
    );
  } else if (pushed?.name === "session") {
    screen = (
      <SessionDetailScreen sessionId={pushed.sessionId} onBack={() => setPushed(null)} />
    );
  } else if (tab === "history") {
    screen = (
      <HistoryScreen
        refreshKey={historyRefresh}
        onOpenSession={(sessionId) => setPushed({ name: "session", sessionId })}
      />
    );
  } else {
    screen = (
      <SettingsScreen
        email={email}
        onSignOut={() => {
          signOutSupabase();
          setEmail(null);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={statusBarStyle} />
      <View style={{ flex: 1 }}>{screen}</View>
      {!pushed && (
        <View style={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)}>
                <Text style={[styles.tabIcon, active && { color: colors.accent }]}>{t.icon}</Text>
                <Text style={[styles.tabLabel, active && { color: colors.accent }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.panel,
    paddingBottom: 6,
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 10, gap: 2 },
  tabIcon: { color: colors.muted, fontSize: 18 },
  tabLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
}));

