// Active workout player (Segment 11). Drives the shared WorkoutEngine and
// renders its GlassesCard through GlassesCardRN - the phone shows exactly
// what the lens will. The engine lives in src/session.ts so minimizing the
// player (or switching tabs) never loses progress and rest keeps ticking.
// Weight is adjustable per exercise; the last lifted weight becomes the
// plan's new default when the workout completes.

import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise } from "@setflow/shared";
import {
  parseVoiceLog,
  resolveVoiceLog,
  type EngineSnapshot,
  type EngineWorkout,
  type WorkoutEngine,
} from "@setflow/workout-engine";
import { colors } from "../theme";
import { getApi } from "../api";
import {
  endSession,
  getSession,
  startSession,
  type ActiveSession,
  type JournalPatch,
} from "../session";
import GlassesCardRN from "../components/GlassesCardRN";
import { Button, Card, ChipRow, Muted } from "../components/ui";

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

/**
 * Voice logging panel (Segment 13). Speak-or-type a phrase; the parser turns
 * it into a set log. High-confidence logs auto-save after 3 seconds unless
 * the user taps Fix (build doc 7.3). Real speech-to-text arrives with the
 * glasses integration - typing (or the keyboard's dictation mic) stands in.
 */
function VoiceLogPanel({
  engine,
  snap,
  context,
}: {
  engine: WorkoutEngine;
  snap: EngineSnapshot;
  context: { lastWeight?: number; lastReps?: number; targetWeight?: number; targetReps?: number };
}) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixWeight, setFixWeight] = useState("");
  const [fixReps, setFixReps] = useState("");

  const confidence = snap.pendingLog?.confidence ?? 0;
  const autoSave = snap.status === "confirming_log" && confidence >= 0.85 && !fixing;

  useEffect(() => {
    if (!autoSave) return;
    const t = setTimeout(() => engine.confirmLog("mobile_voice"), 3000);
    return () => clearTimeout(t);
  }, [autoSave, engine, snap.pendingLog]);

  const submit = () => {
    const parsed = parseVoiceLog(text);
    const resolved = resolveVoiceLog(parsed, { ...context, unit: "lb" });
    switch (resolved.action) {
      case "pending":
        setHint("");
        setText("");
        engine.voiceLog(resolved.pending);
        break;
      case "skip":
        engine.skipSet();
        break;
      case "difficulty":
        setHint(engine.annotateLastResult({ difficulty: resolved.difficulty })
          ? `Marked last set: ${resolved.difficulty}`
          : "No set logged yet to mark.");
        setText("");
        break;
      case "note":
        setHint(engine.annotateLastResult({ note: resolved.note })
          ? "Note added to last set."
          : "No set logged yet for a note.");
        setText("");
        break;
      default:
        setHint('Didn\'t catch that - try "75 for 10" or "same as last set".');
    }
  };

  if (snap.status === "listening_for_log") {
    return (
      <Card style={{ gap: 10 }}>
        <Text style={styles.status}>Say (or type) your set</Text>
        <TextInput
          style={styles.voiceInput}
          value={text}
          onChangeText={setText}
          placeholder='e.g. "75 for 10", "same as last set", "skip"'
          placeholderTextColor={colors.muted}
          autoFocus
          onSubmitEditing={submit}
        />
        {hint ? <Muted>{hint}</Muted> : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Log it" onPress={submit} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" kind="quiet" onPress={() => engine.stopListening()} />
          </View>
        </View>
      </Card>
    );
  }

  // confirming_log
  const pending = snap.pendingLog;
  return (
    <Card style={{ gap: 10 }}>
      {fixing ? (
        <>
          <Text style={styles.status}>Fix the log</Text>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <TextInput
              style={[styles.voiceInput, { flex: 1 }]}
              value={fixWeight}
              onChangeText={setFixWeight}
              keyboardType="numeric"
              placeholder="weight"
              placeholderTextColor={colors.muted}
            />
            <Text style={{ color: colors.muted }}>lb ×</Text>
            <TextInput
              style={[styles.voiceInput, { flex: 1 }]}
              value={fixReps}
              onChangeText={setFixReps}
              keyboardType="numeric"
              placeholder="reps"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Save set"
                onPress={() => {
                  const w = Number(fixWeight);
                  const r = Number(fixReps);
                  engine.correctLog({
                    weight: Number.isFinite(w) && fixWeight.trim() !== "" ? w : undefined,
                    reps: Number.isFinite(r) && fixReps.trim() !== "" ? r : undefined,
                  });
                  engine.confirmLog("mobile_voice");
                  setFixing(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" kind="quiet" onPress={() => setFixing(false)} />
            </View>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.status}>
            {autoSave ? "Auto-saving in 3s..." : "Confirm this set?"}
          </Text>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <View style={{ flexGrow: 1 }}>
              <Button title="Confirm" onPress={() => engine.confirmLog("mobile_voice")} />
            </View>
            <View style={{ flexGrow: 1 }}>
              <Button
                title="Fix"
                kind="quiet"
                onPress={() => {
                  setFixWeight(pending?.weight != null ? String(pending.weight) : "");
                  setFixReps(pending?.reps != null ? String(pending.reps) : "");
                  setFixing(true);
                }}
              />
            </View>
            <View style={{ flexGrow: 1 }}>
              <Button title="Cancel" kind="quiet" onPress={() => engine.previous()} />
            </View>
          </View>
        </>
      )}
    </Card>
  );
}

/** Pre-workout check-in (Segment 15): every tap saves straight to the journal. */
function PreJournalCard({ onPatch }: { onPatch: (p: JournalPatch) => void }) {
  const [j, setJ] = useState<JournalPatch>({});
  const [meal, setMeal] = useState("");
  const set = (p: JournalPatch) => {
    setJ((prev) => ({ ...prev, ...p }));
    onPatch(p);
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.status}>Quick check-in (optional)</Text>
      <ChipRow label="Energy" options={["low", "medium", "high"] as const} value={j.energy} onSelect={(v) => set({ energy: v })} />
      <ChipRow label="Sleep" options={["poor", "okay", "good"] as const} value={j.sleep} onSelect={(v) => set({ sleep: v })} />
      <ChipRow label="Soreness" options={["none", "mild", "moderate", "high"] as const} value={j.soreness} onSelect={(v) => set({ soreness: v })} />
      <ChipRow label="Motivation" options={["low", "medium", "high"] as const} value={j.motivation} onSelect={(v) => set({ motivation: v })} />
      <TextInput
        style={styles.voiceInput}
        value={meal}
        onChangeText={setMeal}
        onEndEditing={() => meal.trim() && onPatch({ preWorkoutMeal: meal.trim() })}
        placeholder="Pre-workout meal (optional), e.g. oatmeal 45 min ago"
        placeholderTextColor={colors.muted}
      />
    </Card>
  );
}

/** Post-workout debrief (Segment 15). */
function PostJournalCard({ onPatch }: { onPatch: (p: JournalPatch) => void }) {
  const [j, setJ] = useState<JournalPatch>({});
  const [bestLift, setBestLift] = useState("");
  const [notes, setNotes] = useState("");
  const set = (p: JournalPatch) => {
    setJ((prev) => ({ ...prev, ...p }));
    onPatch(p);
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.status}>How was it? (optional)</Text>
      <ChipRow label="Overall effort" options={["easy", "moderate", "hard", "brutal"] as const} value={j.overallEffort} onSelect={(v) => set({ overallEffort: v })} />
      <ChipRow label="Mood after" options={["worse", "same", "better"] as const} value={j.moodAfter} onSelect={(v) => set({ moodAfter: v })} />
      <ChipRow label="Pain" options={["none", "mild", "moderate", "severe"] as const} value={j.pain} onSelect={(v) => set({ pain: v })} />
      <TextInput
        style={styles.voiceInput}
        value={bestLift}
        onChangeText={setBestLift}
        onEndEditing={() => bestLift.trim() && onPatch({ bestLift: bestLift.trim() })}
        placeholder="Best lift today (optional)"
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.voiceInput}
        value={notes}
        onChangeText={setNotes}
        onEndEditing={() => notes.trim() && onPatch({ notes: notes.trim() })}
        placeholder="Anything else worth remembering?"
        placeholderTextColor={colors.muted}
      />
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

  // Persistence lives in src/session.ts (Segment 14): the session row is
  // created at start, each set saves as it's logged, completion + weight
  // rollforward happen even if this screen is closed.

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
  const canAddSet = ["active_set", "resting", "exercise_complete"].includes(snap.status);

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
      actions.push({ title: "Log by voice", kind: "quiet", onPress: () => engine.startListening() });
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
  if (canAddSet) {
    actions.push({ title: "Add set", kind: "quiet", onPress: () => engine.addSet() });
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

      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
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

      {snap.status === "workout_preview" && <PreJournalCard onPatch={session.journal} />}
      {snap.status === "workout_complete" && <PostJournalCard onPatch={session.journal} />}

      {(snap.status === "listening_for_log" || snap.status === "confirming_log") && step && (
        <VoiceLogPanel
          engine={engine}
          snap={snap}
          context={{
            lastWeight: [...snap.results]
              .reverse()
              .find((r) => r.workoutStepId === step.step.id && r.status !== "skipped")
              ?.actualWeight,
            lastReps: [...snap.results]
              .reverse()
              .find((r) => r.workoutStepId === step.step.id && r.status !== "skipped")
              ?.actualReps,
            targetWeight: effectiveWeight,
            targetReps: step.step.targetReps,
          }}
        />
      )}

      <View style={styles.actions}>
        {actions.map((a) => (
          <View key={a.title} style={{ flexGrow: 1, flexBasis: "45%" }}>
            <Button title={a.title} kind={a.kind} onPress={a.onPress} />
          </View>
        ))}
      </View>
      </ScrollView>
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
  voiceInput: {
    backgroundColor: colors.panel2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
});
