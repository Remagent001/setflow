// "Today's workout": the sample plan front and center, plus the full list.

import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { WorkoutPlan } from "@setflow/shared";
import { colors, themedStyles } from "../theme";
import { getApi } from "../api";
import { getSession } from "../session";
import { Button, Card, H1, Muted } from "../components/ui";

export default function TodayScreen({
  onOpenPlan,
  onStartPlan,
}: {
  onOpenPlan: (planId: string) => void;
  onStartPlan: (planId: string) => void;
}) {
  const [plans, setPlans] = useState<WorkoutPlan[] | null>(null);

  useEffect(() => {
    getApi().listWorkoutPlans().then(setPlans);
  }, []);

  const today = plans?.[0];
  const active = getSession();
  const styles = getStyles();

  return (
    <View style={styles.wrap}>
      <H1>Today</H1>
      {active && (
        <Card style={{ gap: 10, borderColor: colors.accent }}>
          <Muted>WORKOUT IN PROGRESS</Muted>
          <Text style={styles.title}>{active.planTitle}</Text>
          <Button title="Resume workout" onPress={() => onStartPlan(active.planId)} />
        </Card>
      )}
      {plans === null ? (
        <Muted>Loading...</Muted>
      ) : !today ? (
        <Card>
          <Muted>No workouts yet - create one on the web app.</Muted>
        </Card>
      ) : (
        <>
          <Card style={{ gap: 10 }}>
            <Muted>TODAY&apos;S WORKOUT</Muted>
            <Text style={styles.title}>{today.title}</Text>
            <Muted>
              {today.estimatedDurationMinutes ? `~${today.estimatedDurationMinutes} min` : "Ready when you are"}
            </Muted>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Start workout" onPress={() => onStartPlan(today.id)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Details" kind="quiet" onPress={() => onOpenPlan(today.id)} />
              </View>
            </View>
          </Card>

          {plans.length > 1 && (
            <>
              <Text style={styles.sub}>All workouts</Text>
              <FlatList
                data={plans}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ gap: 10 }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => onOpenPlan(item.id)}>
                    <Card>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Muted>
                        {item.difficulty ?? "any level"}
                        {item.estimatedDurationMinutes ? ` · ~${item.estimatedDurationMinutes} min` : ""}
                      </Muted>
                    </Card>
                  </Pressable>
                )}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  sub: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 4 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
}));
