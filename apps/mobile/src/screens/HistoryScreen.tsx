// Session history (light version - the full logs/history UX is Segment 14).

import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { getApi, MOCK_USER_ID } from "../api";
import { Card, H1, Muted } from "../components/ui";

type Row = {
  id: string;
  planTitle: string;
  completedAt?: string;
  durationSeconds?: number;
  sets: number;
};

export default function HistoryScreen({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const api = getApi();
    const summary = await api.getDashboardSummary(MOCK_USER_ID);
    // The mock api has no listSessions yet (Segment 14 adds it); show the
    // aggregate summary so completed sessions are visible right away.
    setRows(
      summary.workoutsThisWeek > 0
        ? [
            {
              id: "summary",
              planTitle: `${summary.workoutsThisWeek} completed workout${summary.workoutsThisWeek === 1 ? "" : "s"}`,
              sets: summary.totalSets,
              durationSeconds: undefined,
            },
          ]
        : []
    );
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <View style={styles.wrap}>
      <H1>History</H1>
      {rows === null ? (
        <Muted>Loading...</Muted>
      ) : rows.length === 0 ? (
        <Card>
          <Muted>No workouts finished yet - your completed sessions will show up here.</Muted>
        </Card>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 10 }}
          renderItem={({ item }) => (
            <Card>
              <Text style={styles.title}>{item.planTitle}</Text>
              <Muted>{item.sets} sets logged this session run</Muted>
            </Card>
          )}
        />
      )}
      <Muted>Detailed per-set history arrives in Segment 14.</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
