// Active workout player (shell version). Drives the shared WorkoutEngine and
// renders its GlassesCard through GlassesCardRN - the phone shows exactly
// what the lens will. Full player polish (demo playback, voice) is
// Segments 11-13; this already runs a complete workout and saves the session.

import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Exercise } from "@setflow/shared";
import {
  createWorkoutEngine,
  type EngineSnapshot,
  type EngineWorkout,
} from "@setflow/workout-engine";
import { colors } from "../theme";
import { getApi, MOCK_USER_ID } from "../api";
import GlassesCardRN from "../components/GlassesCardRN";
import { Button, Card, Muted } from "../components/ui";

const STATUS_LABELS: Record<EngineSnapshot["status"], string> = {
  idle: "Ready",
  workout_preview: "Workout preview",
  exercise_preview: "Exercise preview",
  demo: "Demo",
  active_set: "Active set",
  listening_for_log: "Listening",
  confirming_log: "Confirm log",
  resting: "Resting",
  exercise_complete: "Exercise done - resting",
  workout_complete: "Workout complete",
  paused: "Paused",
};

export default function PlayerScreen({ planId, onExit }: { planId: string; onExit: () => void }) {
  const [workout, setWorkout] = useState<EngineWorkout | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const savedRef = useRef(false);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    const api = getApi();
    Promise.all([api.getWorkoutPlan(planId), api.listExercises()]).then(([plan, exs]) => {
      if (!plan) return;
      const byId = new Map<string, Exercise>(exs.map((e) => [e.id, e]));
      setWorkout({
        plan,
        steps: plan.steps.flatMap((step) => {
          const exercise = byId.get(step.exerciseId);
          return exercise ? [{ step, exercise }] : [];
        }),
      });
    });
  }, [planId]);

  const engine = useMemo(() => (workout ? createWorkoutEngine(workout) : null), [workout]);

  useEffect(() => {
    if (!engine) return;
    const unsubscribe = engine.subscribe(setSnap);
    engine.start();
    startedAtRef.current = Date.now();
    const interval = setInterval(() => engine.tick(), 1000);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [engine]);

  // Persist the finished session once (History reads these).
  useEffect(() => {
    if (!snap || !engine || snap.status !== "workout_complete" || savedRef.current) return;
    savedRef.current = true;
    const api = getApi();
    const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
    api
      .startSession(MOCK_USER_ID, planId)
      .then(async (session) => {
        for (const r of snap.results) {
          await api.createSetLog({
            sessionId: session.id,
            workoutStepId: r.workoutStepId,
            exerciseId: r.exerciseId,
            setNumber: r.setNumber,
            targetWeight: r.targetWeight,
            targetReps: r.targetReps,
            targetDurationSeconds: r.targetDurationSeconds,
            actualWeight: r.actualWeight,
            actualReps: r.actualReps,
            actualDurationSeconds: r.actualDurationSeconds,
            unit: r.unit,
            status: r.status,
            loggedBy: r.loggedBy,
          });
        }
        await api.completeSession(session.id, durationSeconds);
      })
      .catch(() => {
        savedRef.current = false; // let a re-render retry
      });
  }, [snap, engine, planId]);

  if (!engine || !snap) {
    return (
      <View style={styles.wrap}>
        <Muted>Loading workout...</Muted>
      </View>
    );
  }

  const actions: Array<{ title: string; onPress: () => void; kind?: "quiet" | "danger" }> = [];
  switch (snap.status) {
    case "workout_preview":
      actions.push({ title: "Begin", onPress: () => engine.next() });
      break;
    case "exercise_preview":
      actions.push({ title: "Start set", onPress: () => engine.startSet() });
      if (snap.card.kind === "exercise_preview" && snap.card.hasDemo) {
        actions.push({ title: "Demo", kind: "quiet", onPress: () => engine.showDemo() });
      }
      break;
    case "demo":
      actions.push({ title: "Start set", onPress: () => engine.next() });
      actions.push({ title: "Back", kind: "quiet", onPress: () => engine.previous() });
      break;
    case "active_set":
      actions.push({ title: "Complete set", onPress: () => engine.completeSet() });
      actions.push({ title: "Skip set", kind: "quiet", onPress: () => engine.skipSet() });
      break;
    case "resting":
    case "exercise_complete":
      actions.push({ title: "Skip rest", kind: "quiet", onPress: () => engine.skipRest() });
      break;
    case "paused":
      actions.push({ title: "Resume", onPress: () => engine.resume() });
      break;
    case "workout_complete":
      actions.push({ title: "Done", onPress: onExit });
      break;
    default:
      break;
  }
  if (snap.status !== "workout_complete" && snap.status !== "paused") {
    actions.push({ title: "Pause", kind: "quiet", onPress: () => engine.pause() });
  }
  if (snap.status !== "workout_complete") {
    actions.push({ title: "End workout", kind: "danger", onPress: () => engine.end() });
  }

  const completedSets = snap.results.filter((r) => r.status === "completed").length;

  return (
    <View style={styles.wrap}>
      <GlassesCardRN card={snap.card} />

      <Card style={{ gap: 4 }}>
        <Text style={styles.status}>{STATUS_LABELS[snap.status]}</Text>
        <Muted>
          Exercise {Math.min(snap.exerciseIndex + 1, snap.totalExercises)} of {snap.totalExercises}
          {" · "}set {snap.setNumber} of {snap.setCount}
          {" · "}{completedSets} logged
        </Muted>
      </Card>

      <View style={styles.actions}>
        {actions.map((a) => (
          <View key={a.title} style={{ flexGrow: 1, flexBasis: "45%" }}>
            <Button title={a.title} kind={a.kind} onPress={a.onPress} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.bg },
  status: { color: colors.text, fontSize: 16, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
