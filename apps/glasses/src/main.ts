// SetFlow for the glasses (on-lens Web App). Runs the REAL shared
// workout-engine against an embedded workout and renders GlassesCards as
// DOM at 600x600. Input is the Neural Band: swipes arrive as arrow keys,
// pinch as Enter (per Meta's Web App docs) - same keys work on a desktop
// for testing. Weights you finish with are remembered in localStorage and
// become the next session's defaults, mirroring the phone app.

import { createWorkoutEngine, type EngineSnapshot, type EngineWorkout } from "../../../packages/workout-engine/src/engine";
import type { Exercise, GlassesCard, WorkoutStep } from "../../../packages/shared/src/index";

// --- embedded workout (Upper Body A, same as the app's seed) -----------------

const ts = "2026-07-03T00:00:00.000Z";
const exercise = (id: string, name: string, cue: string): Exercise => ({
  id, name, cues: [cue], createdAt: ts, updatedAt: ts,
});
const step = (
  id: string, exerciseId: string, orderIndex: number,
  over?: Partial<WorkoutStep>
): WorkoutStep => ({
  id, workoutPlanId: "plan-1", exerciseId, orderIndex,
  setCount: 3, targetReps: 10, targetWeight: 75, restSeconds: 90, ...over,
});

const EXERCISES = [
  exercise("ex-1", "Incline Dumbbell Press", "Elbows 45 degrees"),
  exercise("ex-2", "Bent-Over Barbell Row", "Flat back, pull to the ribs"),
  exercise("ex-3", "Overhead Press", "Squeeze glutes, bar close to the face"),
];

const WORKOUT: EngineWorkout = {
  plan: {
    id: "plan-1", ownerUserId: "glasses", title: "Upper Body A",
    estimatedDurationMinutes: 52, createdAt: ts, updatedAt: ts,
  },
  steps: [
    { step: step("st-1", "ex-1", 0, { cue: "Elbows 45 degrees" }), exercise: EXERCISES[0]! },
    { step: step("st-2", "ex-2", 1, { cue: "No momentum" }), exercise: EXERCISES[1]! },
    { step: step("st-3", "ex-3", 2, { cue: "Brace hard" }), exercise: EXERCISES[2]! },
  ],
};

// --- remembered weights (5MB localStorage is available to Web Apps) -----------

const WEIGHTS_KEY = "setflow-weights";
function loadSavedWeights(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? "{}") as Record<string, number>;
    for (const s of WORKOUT.steps) {
      const w = saved[s.exercise.name];
      if (typeof w === "number" && w > 0) s.step.targetWeight = w;
    }
  } catch { /* fresh start */ }
}
function saveWeights(snap: EngineSnapshot): void {
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? "{}") as Record<string, number>;
    for (const r of snap.results) {
      if (r.status !== "skipped" && r.actualWeight != null) {
        const ex = WORKOUT.steps.find((s) => s.step.id === r.workoutStepId)?.exercise.name;
        if (ex) saved[ex] = r.actualWeight;
      }
    }
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(saved));
  } catch { /* storage full - fine */ }
}

// --- rendering -----------------------------------------------------------------

const cardEl = document.getElementById("card")!;
const hintEl = document.getElementById("hint")!;
const pausedEl = document.getElementById("paused")!;

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mmss = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

function cardHtml(card: GlassesCard): string {
  switch (card.kind) {
    case "workout_start":
      return `<div class="dim">READY</div><div class="big">${esc(card.workoutTitle)}</div>
        <div class="mid">${card.exerciseCount} exercises${card.estimatedMinutes ? ` · ~${card.estimatedMinutes} min` : ""}</div>`;
    case "exercise_preview":
      return `<div class="dim">NEXT UP</div><div class="big">${esc(card.exerciseName)}</div>
        <div class="mid">${card.setCount} sets${card.targetReps ? ` × ${card.targetReps}` : ""} · rest ${card.restSeconds}s</div>`;
    case "demo":
      return `<div class="dim">DEMO</div><div class="mid">${esc(card.exerciseName)}</div>
        ${card.cue ? `<div class="dim">${esc(card.cue)}</div>` : ""}`;
    case "active_set":
      return `<div class="mid">${esc(card.exerciseName)}</div>
        <div class="dim">SET ${card.setNumber} / ${card.setCount}</div>
        ${card.remainingSeconds != null ? `<div class="huge">${mmss(card.remainingSeconds)}</div>` : ""}
        <div class="big">${card.targetWeight != null ? `${card.targetWeight} ${card.unit}` : ""}${card.targetWeight != null && card.targetReps != null ? " × " : ""}${card.targetReps ?? ""}</div>`;
    case "listening":
      return `<div class="huge">🎙</div><div class="mid">Listening…</div>`;
    case "confirmation":
      return `<div class="dim">LOGGED</div>
        <div class="big">${card.loggedWeight != null ? `${card.loggedWeight} ${card.unit}` : ""}${card.loggedWeight != null && card.loggedReps != null ? " × " : ""}${card.loggedReps ?? ""}</div>
        <div class="dim">Rest ${card.restSeconds}s</div>`;
    case "correction":
      return `<div class="dim">WHICH ONE?</div>` +
        card.options.map((o, i) => `<div class="mid">${i + 1}. ${o.weight ?? ""} × ${o.reps ?? ""}</div>`).join("");
    case "rest":
      return `${card.exerciseName ? `<div class="mid">${esc(card.exerciseName)}</div>` : ""}
        <div class="dim">REST</div><div class="huge">${mmss(card.remainingSeconds)}</div>
        <div class="mid">Next: ${esc(card.nextLabel)}</div>`;
    case "workout_complete":
      return `<div class="big green">✔ Done</div>
        <div class="mid">${card.totalSets} sets · ${card.durationMinutes} min</div>
        ${card.message ? `<div class="dim">${esc(card.message)}</div>` : ""}`;
  }
}

const HINTS: Partial<Record<EngineSnapshot["status"], string>> = {
  workout_preview: "pinch to begin",
  exercise_preview: "pinch to start the set",
  demo: "pinch to start the set",
  active_set: "pinch when done · swipe ↑ add set · ↓ skip",
  resting: "pinch to skip rest · swipe ↑ add set",
  exercise_complete: "pinch to skip rest",
  workout_complete: "pinch to start again",
};

function render(snap: EngineSnapshot): void {
  cardEl.innerHTML = cardHtml(snap.card);
  hintEl.textContent = HINTS[snap.status] ?? "";
  pausedEl.style.display = snap.status === "paused" ? "block" : "none";
}

// --- engine wiring ----------------------------------------------------------------

let engine = createWorkoutEngine(WORKOUT, { unit: "lb" });
let saved = false;

function boot(): void {
  saved = false;
  loadSavedWeights();
  engine = createWorkoutEngine(WORKOUT, { unit: "lb" });
  engine.subscribe((snap) => {
    render(snap);
    if (snap.status === "workout_complete" && !saved) {
      saved = true;
      saveWeights(snap);
    }
  });
  engine.start();
}

setInterval(() => engine.tick(), 1000);

// Neural Band mapping: pinch = Enter, swipes = arrows, mid-pinch = Escape.
document.addEventListener("keydown", (e) => {
  const status = engine.snapshot().status;
  switch (e.key) {
    case "Enter":
      if (status === "workout_preview") engine.next();
      else if (status === "exercise_preview" || status === "demo") engine.startSet();
      else if (status === "active_set") engine.completeSet();
      else if (status === "resting" || status === "exercise_complete") engine.skipRest();
      else if (status === "confirming_log") engine.confirmLog();
      else if (status === "paused") engine.resume();
      else if (status === "workout_complete") boot();
      break;
    case "ArrowRight":
      if (status === "resting" || status === "exercise_complete") engine.skipRest();
      else engine.next();
      break;
    case "ArrowLeft":
      engine.previous();
      break;
    case "ArrowUp":
      engine.addSet();
      break;
    case "ArrowDown":
      engine.skipSet();
      break;
    case "Escape":
      if (status === "paused") engine.resume();
      else engine.pause();
      break;
    default:
      return;
  }
  e.preventDefault();
});

boot();
