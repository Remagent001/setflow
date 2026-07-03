// Active workout player (Segment 11). Drives the shared WorkoutEngine and
// renders its GlassesCard through GlassesCardRN - the phone shows exactly
// what the lens will. The engine lives in src/session.ts so minimizing the
// player (or switching tabs) never loses progress and rest keeps ticking.
// Weight is adjustable per exercise; the last lifted weight becomes the
// plan's new default when the workout completes.

import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise } from "@setflow/shared";
import type { EngineSnapshot, EngineWorkout } from "@setflow/workout-engine";
import { colors } from "../theme";
import { getApi, MOCK_USER_ID } from "../api";
import { endSession, getSession, startSession, type ActiveSession } from "../session";
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

/** Per-exercise weight editor: type a number or nudge with +/- 5. */
function WeightEditor({
  effectiveWeight,
  onChange,
}: {
  effectiveWeight: number | undefined;
  onChange: (weight: number | null) => void;
}) {
  const [text, setText] = useState(effectiveWeight != null ? String(effectiveWeight) : "");

  const commit = (raw: string) => {
    setText(raw);
    const n = Number(raw.trim());
    onChange(raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null);
  };
  const nudge = (delta: number) => {
    const base = Number(text.trim());
    const next = Math.max(0, (Number.isFinite(base) ? base : 0) + delta);
    commit(String(next));
  };

  return (
    <Card style={styles.weightRow}>
      <Text style={styles.weightLabel}>Weight</Text>
      <Button title="-5" kind="quiet" onPress={() => nudge(-5)} />
      <TextInput
        style={styles.weightInput}
        value={text}
        onChangeText={commit}
        keyboardType="numeric"
        placeholder="--"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.weightUnit}>lb</Text>
      <Button title="+5" kind="quiet" onPress={() => nudge(5)} />
    </Card>
  );
}

export default function PlayerScreen({
  planId,
  onExit,
  onMinimize,
}: {
  planId: string;
  onExit: () => void;
  onMinimize: () => void;
}) {
  const [workout, setWorkout] = useState<EngineWorkout | null>(null);
  const [session, setSession] = useState<ActiveSession | null>(() => getSession(planId));
  const [snap, setSnap] = useState<EngineSnapshot | null>(session?.engine.snapshot() ?? null);

  useEffect(() => {
    const api = getApi();
    Promise.all([api.getWorkoutPlan(planId), api.listExercises()]).then(async ([plan, exs]) => {
      if (!plan) return;
      const byId = new Map<string, Exercise>(exs.map((e) => [e.id, e]));
      const steps = await Promise.all(
        plan.steps.map(async (step) => {
          const exercise = byId.get(step.exerciseId);
          if (!exercise) return null;
          const media = await api.listExerciseMedia(step.exerciseId);
          const video = media.find((m) => m.mediaType === "video") ?? media[0];
          return {
            step,
            exercise,
            demo: video
              ? {
                  url: video.url,
                  thumbnailUrl: video.thumbnailUrl,
                  durationSeconds: video.durationSeconds,
                  mediaType: video.mediaType,
                }
              : undefined,
          };
        })
      );
      setWorkout({ plan, steps: steps.filter((s) => s !== null) });
    });
  }, [planId]);

  // Attach to the running session, or start one once the plan is loaded.
  useEffect(() => {
    if (session) return;
    if (!workout) return;
    setSession(startSession(planId, workout));
  }, [session, workout, planId]);

  useEffect(() => {
    if (!session) return;
    setSnap(session.engine.snapshot());
    return session.engine.subscribe(setSnap);
  }, [session]);

  // On completion: write the session + set logs, then roll the weights the
  // user actually lifted forward as the plan's new defaults.
  useEffect(() => {
    if (!snap || !session || !workout || snap.status !== "workout_complete" || session.saved)
      return;
    session.saved = true;
    const api = getApi();
    const durationSeconds = Math.round((Date.now() - session.startedAtMs) / 1000);
    (async () => {
      const dbSession = await api.startSession(MOCK_USER_ID, planId);
      for (const r of snap.results) {
        await api.createSetLog({
          sessionId: dbSession.id,
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
      await api.completeSession(dbSession.id, durationSeconds);

      // "Next time, default to what I actually lifted."
      const lastWeightByStep = new Map<string, number>();
      for (const r of snap.results) {
        if (r.status === "completed" && r.actualWeight != null) {
          lastWeightByStep.set(r.workoutStepId, r.actualWeight);
        }
      }
      for (const [stepId, weight] of lastWeightByStep) {
        const step = workout.steps.find((s) => s.step.id === stepId);
        if (step && step.step.targetWeight !== weight) {
          await api.updateWorkoutStep(stepId, { targetWeight: weight });
        }
      }
    })().catch(() => {
      session.saved = false; // allow a retry on the next render
    });
  }, [snap, session, workout, planId]);

  if (!session || !snap) {
    return (
      <View style={styles.wrap}>
        <Muted>Loading workout...</Muted>
      </View>
    );
  }

  const engine = session.engine;
  const step = workout?.steps[snap.exerciseIndex];
  const effectiveWeight = snap.weightOverride ?? step?.step.targetWeight;
  const canEditWeight = ["exercise_preview", "demo", "active_set"].includes(snap.status);
  const canGoBack = ["demo", "active_set", "listening_for_log", "exercise_preview"].includes(
    snap.status
  );

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
      actions.push({
        title: "Done",
        onPress: () => {
          endSession();
          onExit();
        },
      });
      break;
    default:
      break;
  }
  if (canGoBack) {
    actions.push({ title: "Back", kind: "quiet", onPress: () => engine.previous() });
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
      <View style={styles.header}>
        <Text style={styles.minimize} onPress={onMinimize}>
          ‹ Home
        </Text>
        <Text style={styles.headerTitle}>{session.planTitle}</Text>
        <View style={{ width: 60 }} />
      </View>

      <GlassesCardRN card={snap.card} />

      <Card style={{ gap: 4 }}>
        <Text style={styles.status}>{STATUS_LABELS[snap.status]}</Text>
        <Muted>
          {step ? `${step.exercise.name} · ` : ""}
          exercise {Math.min(snap.exerciseIndex + 1, snap.totalExercises)} of{" "}
          {snap.totalExercises} · set {snap.setNumber} of {snap.setCount} · {completedSets} logged
        </Muted>
      </Card>

      {canEditWeight && step && (
        <WeightEditor
          key={step.step.id}
          effectiveWeight={effectiveWeight}
          onChange={(w) => engine.setWeightOverride(w)}
        />
      )}

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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  minimize: { color: colors.accent, fontSize: 15, fontWeight: "600", width: 60 },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  status: { color: colors.text, fontSize: 16, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  weightLabel: { color: colors.muted, fontSize: 13, fontWeight: "600", flex: 1 },
  weightInput: {
    backgroundColor: colors.panel2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: "700",
    minWidth: 70,
    textAlign: "center",
  },
  weightUnit: { color: colors.muted, fontSize: 13 },
});
