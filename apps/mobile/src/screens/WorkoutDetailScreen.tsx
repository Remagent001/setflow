// Read-only plan view: the ordered exercise sequence (editing lives on web).

import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Exercise } from "@setflow/shared";
import type { WorkoutPlanWithSteps } from "@setflow/api-client";
import { colors } from "../theme";
import { getApi } from "../api";
import { Button, Card, H1, Muted } from "../components/ui";

export default function WorkoutDetailScreen({
  planId,
  onStart,
  onBack,
}: {
  planId: string;
  onStart: () => void;
  onBack: () => void;
}) {
  const [plan, setPlan] = useState<WorkoutPlanWithSteps | null | undefined>(undefined);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());

  useEffect(() => {
    const api = getApi();
    Promise.all([api.getWorkoutPlan(planId), api.listExercises()]).then(([p, exs]) => {
      setPlan(p);
      setExercises(new Map(exs.map((e) => [e.id, e])));
    });
  }, [planId]);

  if (plan === undefined) {
    return (
      <View style={styles.wrap}>
        <Muted>Loading...</Muted>
      </View>
    );
  }
  if (plan === null) {
    return (
      <View style={styles.wrap}>
        <Muted>Workout not found.</Muted>
        <Button title="Back" kind="quiet" onPress={onBack} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <H1>{plan.title}</H1>
      <Muted>
        {plan.difficulty ? `${plan.difficulty} · ` : ""}
        {plan.estimatedDurationMinutes ? `~${plan.estimatedDurationMinutes} min · ` : ""}
        {plan.steps.length} exercise{plan.steps.length === 1 ? "" : "s"}
      </Muted>

      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {plan.steps.map((s, i) => {
          const ex = exercises.get(s.exerciseId);
          return (
            <Card key={s.id} style={{ gap: 4 }}>
              <Text style={styles.stepTitle}>
                {i + 1}. {ex?.name ?? "Unknown exercise"}
              </Text>
              <Muted>
                {s.setCount} sets
                {s.targetReps != null ? ` × ${s.targetReps} reps` : ""}
                {s.targetWeight != null ? ` · ${s.targetWeight} lb` : ""}
                {s.targetDurationSeconds != null ? ` · ${s.targetDurationSeconds}s` : ""}
                {` · rest ${s.restSeconds}s`}
              </Muted>
              {s.cue ? <Text style={styles.cue}>Cue: {s.cue}</Text> : null}
              {s.notes ? <Muted>{s.notes}</Muted> : null}
            </Card>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Start workout" onPress={onStart} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Back" kind="quiet" onPress={onBack} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 12, backgroundColor: colors.bg },
  stepTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  cue: { color: colors.green, fontSize: 13 },
});
