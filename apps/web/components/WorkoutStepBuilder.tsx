"use client";

// The step builder: the ordered exercise sequence inside a workout plan.
// Add steps from the exercise library, reorder with up/down, edit each
// step's targets (sets, reps, weight, duration, rest, cue, notes) inline,
// and remove with a two-click confirm (no browser dialogs).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Exercise, WorkoutStep } from "@setflow/shared";
import { getApi } from "../lib/api";

type StepDraft = {
  setCount: string;
  targetReps: string;
  targetWeight: string;
  targetDurationSeconds: string;
  restSeconds: string;
  cue: string;
  notes: string;
};

function draftFromStep(s: WorkoutStep): StepDraft {
  const str = (n?: number) => (n != null ? String(n) : "");
  return {
    setCount: String(s.setCount),
    targetReps: str(s.targetReps),
    targetWeight: str(s.targetWeight),
    targetDurationSeconds: str(s.targetDurationSeconds),
    restSeconds: String(s.restSeconds),
    cue: s.cue ?? "",
    notes: s.notes ?? "",
  };
}

function summarize(s: WorkoutStep): string {
  const parts: string[] = [];
  let work = `${s.setCount} set${s.setCount === 1 ? "" : "s"}`;
  if (s.targetReps != null) work += ` × ${s.targetReps} reps`;
  if (s.targetDurationSeconds != null) work += ` × ${s.targetDurationSeconds}s`;
  parts.push(work);
  if (s.targetWeight != null) parts.push(`${s.targetWeight} lb`);
  parts.push(`rest ${s.restSeconds}s`);
  return parts.join(" · ");
}

export default function WorkoutStepBuilder({ planId }: { planId: string }) {
  const [steps, setSteps] = useState<WorkoutStep[] | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [addExerciseId, setAddExerciseId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StepDraft | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = getApi();
    Promise.all([api.getWorkoutPlan(planId), api.listExercises()]).then(([plan, exs]) => {
      setSteps(plan?.steps ?? []);
      setExercises(exs);
    });
  }, [planId]);

  const exerciseById = useMemo(() => {
    const m = new Map<string, Exercise>();
    exercises.forEach((e) => m.set(e.id, e));
    return m;
  }, [exercises]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const addStep = () =>
    run(async () => {
      if (!addExerciseId || !steps) return;
      const created = await getApi().addWorkoutStep({
        workoutPlanId: planId,
        exerciseId: addExerciseId,
        orderIndex: steps.length,
        setCount: 3,
        targetReps: 10,
        restSeconds: 90,
      });
      setSteps([...steps, created]);
      setAddExerciseId("");
      setEditingId(created.id);
      setDraft(draftFromStep(created));
    });

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      if (!steps) return;
      const target = index + delta;
      if (target < 0 || target >= steps.length) return;
      const moved = steps[index];
      const displaced = steps[target];
      if (!moved || !displaced) return;
      const api = getApi();
      const [movedSaved, displacedSaved] = await Promise.all([
        api.updateWorkoutStep(moved.id, { orderIndex: target }),
        api.updateWorkoutStep(displaced.id, { orderIndex: index }),
      ]);
      const next = [...steps];
      next[index] = displacedSaved;
      next[target] = movedSaved;
      setSteps(next);
    });

  const remove = (stepId: string) =>
    run(async () => {
      if (!steps) return;
      await getApi().deleteWorkoutStep(stepId);
      const remaining = steps.filter((s) => s.id !== stepId);
      // Close the gap so orderIndex always matches list position.
      const api = getApi();
      const reindexed = await Promise.all(
        remaining.map((s, i) => (s.orderIndex === i ? s : api.updateWorkoutStep(s.id, { orderIndex: i })))
      );
      setSteps(reindexed);
      setConfirmRemoveId(null);
      if (editingId === stepId) {
        setEditingId(null);
        setDraft(null);
      }
    });

  const saveDraft = (step: WorkoutStep) =>
    run(async () => {
      if (!draft || !steps) return;
      const num = (v: string): number | undefined => {
        const t = v.trim();
        if (t === "") return undefined;
        const n = Number(t);
        return Number.isFinite(n) ? n : undefined;
      };
      const setCount = num(draft.setCount);
      if (setCount === undefined || setCount < 1) {
        setError("Sets must be at least 1.");
        return;
      }
      const restSeconds = num(draft.restSeconds);
      if (restSeconds === undefined || restSeconds < 0) {
        setError("Rest must be 0 or more seconds.");
        return;
      }
      const updated = await getApi().updateWorkoutStep(step.id, {
        setCount: Math.round(setCount),
        targetReps: num(draft.targetReps),
        targetWeight: num(draft.targetWeight),
        targetDurationSeconds: num(draft.targetDurationSeconds),
        restSeconds: Math.round(restSeconds),
        cue: draft.cue.trim() || undefined,
        notes: draft.notes.trim() || undefined,
      });
      setSteps(steps.map((s) => (s.id === step.id ? updated : s)));
      setEditingId(null);
      setDraft(null);
    });

  if (steps === null) {
    return <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>Loading steps...</div>;
  }

  const numField = (
    label: string,
    key: keyof StepDraft,
    props?: React.InputHTMLAttributes<HTMLInputElement>
  ) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 110, flex: 1 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{label}</span>
      <input
        type="number"
        value={draft?.[key] ?? ""}
        onChange={(e) => draft && setDraft({ ...draft, [key]: e.target.value })}
        {...props}
      />
    </label>
  );

  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Exercise sequence</h2>

      {steps.length === 0 && (
        <div className="card" style={{ color: "var(--muted)" }}>
          No exercises yet - add the first one below.
        </div>
      )}

      {steps.map((step, i) => {
        const exercise = exerciseById.get(step.exerciseId);
        const editing = editingId === step.id;
        return (
          <div key={step.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  background: "var(--panel2)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {exercise ? (
                    <Link href={`/exercises/${exercise.id}`} style={{ color: "var(--text)" }}>
                      {exercise.name}
                    </Link>
                  ) : (
                    "Unknown exercise"
                  )}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>{summarize(step)}</div>
                {step.cue && (
                  <div style={{ color: "var(--green)", fontSize: 12, marginTop: 2 }}>
                    Cue: {step.cue}
                  </div>
                )}
                {step.notes && (
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                    {step.notes}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move ${exercise?.name ?? "step"} up`}
                  style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 10px" }}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move ${exercise?.name ?? "step"} down`}
                  style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 10px" }}
                  disabled={busy || i === steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 12px" }}
                  disabled={busy}
                  onClick={() => {
                    if (editing) {
                      setEditingId(null);
                      setDraft(null);
                    } else {
                      setEditingId(step.id);
                      setDraft(draftFromStep(step));
                      setConfirmRemoveId(null);
                    }
                  }}
                >
                  {editing ? "Close" : "Edit"}
                </button>
                {confirmRemoveId === step.id ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "#e5534b", color: "#fff", padding: "6px 12px" }}
                    disabled={busy}
                    onClick={() => remove(step.id)}
                  >
                    Really remove?
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--panel2)", color: "#ff7a7a", padding: "6px 12px" }}
                    disabled={busy}
                    onClick={() => setConfirmRemoveId(step.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {editing && draft && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {numField("Sets *", "setCount", { min: 1 })}
                  {numField("Target reps", "targetReps", { min: 1 })}
                  {numField("Weight (lb)", "targetWeight", { min: 0, step: "any" })}
                  {numField("Duration (sec)", "targetDurationSeconds", { min: 1 })}
                  {numField("Rest (sec) *", "restSeconds", { min: 0 })}
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Cue</span>
                  <input
                    value={draft.cue}
                    onChange={(e) => setDraft({ ...draft, cue: e.target.value })}
                    placeholder="Short reminder shown on the glasses, e.g. Elbows tucked"
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Notes</span>
                  <input
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="Anything else, e.g. use the adjustable bench"
                  />
                </label>
                <div>
                  <button type="button" className="btn" disabled={busy} onClick={() => saveDraft(step)}>
                    {busy ? "Saving..." : "Save step"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add exercise</div>
        {exercises.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Your exercise library is empty -{" "}
            <Link href="/exercises/new" style={{ color: "var(--accent)" }}>
              create an exercise
            </Link>{" "}
            first.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={addExerciseId}
              onChange={(e) => setAddExerciseId(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            >
              <option value="">Choose an exercise...</option>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.primaryMuscleGroup ? ` (${e.primaryMuscleGroup})` : ""}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy || !addExerciseId} onClick={addStep}>
              + Add to workout
            </button>
          </div>
        )}
      </div>

      {error && <div style={{ color: "#ff7a7a", fontSize: 13 }}>{error}</div>}
    </div>
  );
}
