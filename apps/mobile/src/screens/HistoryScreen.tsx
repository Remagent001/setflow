// Workout history (Segment 14): completed sessions, newest first.
// Tap one to open the session detail with editable set logs.

import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { WorkoutSession } from "@setflow/shared";
import { colors, themedStyles } from "../theme";
import { getApi, MOCK_USER_ID } from "../api";
import { Card, H1, Muted } from "../components/ui";

type Row = WorkoutSession & { planTitle: string; setCount: number };

const STATUS_LABELS: Record<WorkoutSession["status"], string> = {
  not_started: "not started",
  in_progress: "in progress",
  completed: "completed",
  abandoned: "ended early",
};

export default function HistoryScreen({
  refreshKey,
  onOpenSession,
}: {
  refreshKey: number;
  onOpenSession: (sessionId: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const api = getApi();
    const sessions = await api.listSessions(MOCK_USER_ID);
    const withDetail = await Promise.all(
      sessions.map(async (s) => {
        const [plan, logs] = await Promise.all([
          api.getWorkoutPlan(s.workoutPlanId),
          api.listSetLogs(s.id),
        ]);
        return { ...s, planTitle: plan?.title ?? "Workout", setCount: logs.length };
      })
    );
    setRows(withDetail);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const mins = (s?: number) => (s != null ? `${Math.max(1, Math.round(s / 60))} min` : "");
  const styles = getStyles();

  return (
    <View style={styles.wrap}>
      <H1>History</H1>
      {rows === null ? (
        <Muted>Loading...</Muted>
      ) : rows.length === 0 ? (
        <Card>
          <Muted>No workouts yet - your completed sessions will show up here.</Muted>
        </Card>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 10 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => onOpenSession(item.id)}>
              <Card>
                <Text style={styles.title}>{item.planTitle}</Text>
                <Muted>
                  {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                  {STATUS_LABELS[item.status]}
                  {item.durationSeconds != null ? ` · ${mins(item.durationSeconds)}` : ""} ·{" "}
                  {item.setCount} set{item.setCount === 1 ? "" : "s"}
                </Muted>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
}));
