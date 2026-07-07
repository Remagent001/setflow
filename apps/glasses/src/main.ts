// SetFlow for the glasses (on-lens Web App). Runs the REAL shared
// workout-engine and renders at 600x600. Input is the Neural Band: swipes
// arrive as arrow keys, index pinch as Enter, middle-finger pinch as Escape
// (per Meta's Web App docs) - the same keys drive it on a desktop for testing.
//
// HOME: a grid of Day 1-5 cards. Swipe up/down/left/right to pick, pinch to
// start. Finished days dim out for the current cycle; when all are done they
// all re-brighten (fresh week). Set flow: preview -> READY (dial weight/reps)
// -> pinch -> LIFT (green cue + a count-UP stopwatch) -> pinch (stops + logs
// the set with its duration) -> REST (count-down) -> next set. Weight AND reps
// both persist across sets and into next week; a per-day "last session" is
// kept too. Middle-pinch exits to the day grid from anywhere.

import {
  createWorkoutEngine,
  type EngineSnapshot,
  type EngineWorkout,
  type WorkoutEngine,
} from "../../../packages/workout-engine/src/engine";
import { WORKOUTS as GENERATED } from "./workouts.generated";

// --- workouts (Keith's real Day 1-5, baked in) with a tiny offline fallback --

const TS = "2026-07-06T00:00:00.000Z";
const FALLBACK: EngineWorkout[] = [
  {
    plan: { id: "fallback", ownerUserId: "glasses", title: "Day 1 · Full Body", estimatedDurationMinutes: 30, createdAt: TS, updatedAt: TS },
    steps: [
      { step: { id: "f1", workoutPlanId: "fallback", exerciseId: "fx1", orderIndex: 0, setCount: 3, targetReps: 10, targetWeight: 45, restSeconds: 90, cue: "Warm up first" }, exercise: { id: "fx1", name: "Goblet Squat", cues: ["Chest up"], createdAt: TS, updatedAt: TS } },
    ],
  },
];
const WORKOUTS: EngineWorkout[] = (GENERATED && GENERATED.length ? GENERATED : FALLBACK) as EngineWorkout[];

const WEIGHT_STEP = 5; // lbs per swipe
const COLS = 2;        // day-grid columns

// --- persisted state (5MB localStorage is available to Web Apps) -------------

const WEIGHTS_KEY = "setflow-weights"; // { [exerciseName]: number }
const REPS_KEY = "setflow-reps";       // { [exerciseName]: number }
const LAST_KEY = "setflow-last";       // { [dayTitle]: LastSession }
const CYCLE_KEY = "setflow-cycle";     // boolean[] — days done this cycle

type LastSession = {
  durationMin: number;
  totalSets: number;
  perExercise: Record<string, { weight?: number; reps?: number }>;
  when: number;
};

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
function applySaved(): void {
  const w = readJson<Record<string, number>>(WEIGHTS_KEY, {});
  const r = readJson<Record<string, number>>(REPS_KEY, {});
  for (const wk of WORKOUTS) for (const s of wk.steps) {
    const sw = w[s.exercise.name];
    if (typeof sw === "number" && sw > 0) s.step.targetWeight = sw;
    const sr = r[s.exercise.name];
    if (typeof sr === "number" && sr > 0) s.step.targetReps = sr;
  }
}
function saveWeightsAndReps(snap: EngineSnapshot): void {
  try {
    const w = readJson<Record<string, number>>(WEIGHTS_KEY, {});
    for (const res of snap.results) {
      if (res.status === "skipped") continue;
      const name = exNameForStepId(res.workoutStepId);
      if (!name) continue;
      if (res.actualWeight != null) w[name] = res.actualWeight;
    }
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w));
    const r = readJson<Record<string, number>>(REPS_KEY, {});
    for (const [stepId, reps] of repOverride) {
      const name = exNameForStepId(stepId);
      if (name && reps > 0) r[name] = reps;
    }
    localStorage.setItem(REPS_KEY, JSON.stringify(r));
  } catch { /* storage full - fine */ }
}
function saveLastSession(dayTitle: string, snap: EngineSnapshot, durationMin: number): void {
  try {
    const all = readJson<Record<string, LastSession>>(LAST_KEY, {});
    const perExercise: LastSession["perExercise"] = {};
    for (const res of snap.results) {
      if (res.status === "skipped" || res.actualWeight == null) continue;
      const name = exNameForStepId(res.workoutStepId);
      if (name) perExercise[name] = { weight: res.actualWeight, reps: res.actualReps };
    }
    all[dayTitle] = {
      durationMin,
      totalSets: snap.results.filter((r) => r.status === "completed").length,
      perExercise, when: Date.now(),
    };
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch { /* fine */ }
}
function loadCycle(): boolean[] {
  const arr = readJson<boolean[]>(CYCLE_KEY, []);
  return WORKOUTS.map((_, i) => Boolean(arr[i]));
}
function markDayDone(i: number): void {
  const done = loadCycle();
  done[i] = true;
  if (done.every(Boolean)) done.fill(false); // whole cycle finished -> fresh week
  try { localStorage.setItem(CYCLE_KEY, JSON.stringify(done)); } catch { /* fine */ }
}
function firstUndone(): number {
  const done = loadCycle();
  const i = done.findIndex((d) => !d);
  return i < 0 ? 0 : i;
}

// --- app state ----------------------------------------------------------------

type Mode = "home" | "workout";
type Phase = "ready" | "lifting";
let mode: Mode = "home";
let homeSel = 0;                 // selected day card on the home grid
let dayIndex = 0;                // the day currently being performed
let engine: WorkoutEngine | null = null;
let phase: Phase = "ready";      // within a set: dialing in vs actually lifting
let liftElapsed = 0;            // count-up stopwatch (seconds) while lifting
const repOverride = new Map<string, number>(); // per step id, this session
let lastSetKey = "";
let savedOnComplete = false;
let menuOpen = false;           // the mid-workout quit/save menu
let menuSel = 0;
let endedEarly = false;         // "Finish & save" was used (don't mark day complete)
const MENU = ["Resume", "Finish & save", "Discard"];

function day(): EngineWorkout { return WORKOUTS[dayIndex]!; }
function stepAt(i: number) { return day().steps[i]; }
function exNameForStepId(id: string): string | undefined {
  for (const w of WORKOUTS) { const s = w.steps.find((x) => x.step.id === id); if (s) return s.exercise.name; }
  return undefined;
}
function cueForIndex(i: number): string | undefined {
  const s = stepAt(i);
  return s?.step.cue ?? s?.exercise.cues?.[0];
}
function repsForIndex(i: number, fallbackReps?: number): number | undefined {
  const s = stepAt(i);
  if (!s) return fallbackReps;
  return repOverride.get(s.step.id) ?? fallbackReps;
}
function lastForExercise(dayTitle: string, exName: string) {
  return readJson<Record<string, LastSession>>(LAST_KEY, {})[dayTitle]?.perExercise?.[exName];
}
function splitTitle(title: string): [string, string] {
  const i = title.indexOf("·"); // middle dot in "Day 1 · Push"
  return i < 0 ? [title.trim(), ""] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

// --- DOM ----------------------------------------------------------------------

const cardEl = document.getElementById("card")!;
const hintEl = document.getElementById("hint")!;
const topEl = document.getElementById("topbar")!;
const progEl = document.getElementById("progress")!;
const fillEl = document.getElementById("progressfill")!;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mmss = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
const setProgress = (frac: number) => { (fillEl as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; };

// --- rendering ----------------------------------------------------------------

function renderHome(): void {
  (progEl as HTMLElement).style.display = "none";
  const done = loadCycle();
  const doneCount = done.filter(Boolean).length;
  topEl.textContent = `This cycle · ${doneCount} of ${WORKOUTS.length} done`;
  const cards = WORKOUTS.map((w, i) => {
    const [dn, dt] = splitTitle(w.plan.title);
    const cls = `daycard${done[i] ? " done" : ""}${i === homeSel ? " sel" : ""}`;
    return `<div class="${cls}">${done[i] ? '<span class="check">✔</span>' : ""}` +
      `<div class="dn">${esc(dn)}</div><div class="dt">${esc(dt)}</div>` +
      `<div class="dc">${w.steps.length} exercises</div></div>`;
  }).join("");
  cardEl.innerHTML = `<div class="grid">${cards}</div>`;
  hintEl.textContent = "swipe to pick your day · pinch to start";
}

function renderWorkout(snap: EngineSnapshot): void {
  (progEl as HTMLElement).style.display = "block";
  const c: any = snap.card;
  const total = snap.totalExercises || 1;
  topEl.textContent = `${esc(day().plan.title)} · ${Math.min(snap.exerciseIndex + 1, total)}/${total}`;
  setProgress(snap.exerciseIndex / total);

  switch (c.kind) {
    case "exercise_preview":
      cardEl.innerHTML =
        `<div class="dim">NEXT UP</div><div class="big">${esc(c.exerciseName)}</div>
         <div class="mid">${c.setCount} sets${c.targetReps ? ` × ${c.targetReps}` : ""} · rest ${c.restSeconds}s</div>`;
      hintEl.textContent = "pinch to set up · mid-pinch to exit";
      break;

    case "active_set": {
      const weight = c.targetWeight;
      const reps = repsForIndex(snap.exerciseIndex, c.targetReps);
      const wr = `${weight != null ? `${weight} ${c.unit}` : ""}${weight != null && reps != null ? " × " : ""}${reps ?? ""}`;
      if (phase === "ready") {
        const cue = cueForIndex(snap.exerciseIndex);
        const last = lastForExercise(day().plan.title, c.exerciseName);
        const lastStr = last && last.weight != null ? `last: ${last.weight}${last.reps != null ? ` × ${last.reps}` : ""}` : "";
        cardEl.innerHTML =
          `<div class="mid">${esc(c.exerciseName)}</div>
           <div class="dim">SET ${snap.setNumber} / ${snap.setCount} · READY</div>
           <div class="big">${wr}</div>
           ${cue ? `<div class="dim">${esc(cue)}</div>` : ""}
           ${lastStr ? `<div class="tiny">${lastStr}</div>` : ""}`;
        hintEl.textContent = "←→ weight · ↑↓ reps · pinch = start lifting";
      } else {
        cardEl.innerHTML =
          `<div class="mid">${esc(c.exerciseName)}</div>
           <div class="lift"><span class="dot"></span>LIFT NOW</div>
           <div class="huge">${mmss(liftElapsed)}</div>
           <div class="big">${wr}</div>`;
        hintEl.textContent = "pinch when the set is done · mid-pinch exit";
      }
      break;
    }

    case "rest":
      cardEl.innerHTML =
        `${c.exerciseName ? `<div class="mid">${esc(c.exerciseName)}</div>` : ""}
         <div class="dim">REST</div><div class="huge">${mmss(c.remainingSeconds)}</div>
         <div class="mid">Next: ${esc(c.nextLabel)}</div>`;
      hintEl.textContent = "pinch to start the next set · swipe ↑ add set · mid-pinch exit";
      break;

    case "workout_complete": {
      setProgress(1);
      const last = readJson<Record<string, LastSession>>(LAST_KEY, {})[day().plan.title];
      const cmp = last ? `<div class="tiny">last time: ${last.durationMin} min · ${last.totalSets} sets</div>` : "";
      cardEl.innerHTML =
        `<div class="big green">✔ Done</div>
         <div class="mid">${c.totalSets} sets · ${c.durationMinutes} min</div>
         ${cmp}${c.message ? `<div class="dim">${esc(c.message)}</div>` : ""}`;
      hintEl.textContent = "pinch to return to your days";
      break;
    }

    default:
      cardEl.innerHTML = `<div class="mid">${esc(c.exerciseName ?? "")}</div>`;
      hintEl.textContent = "pinch to continue · mid-pinch exit";
  }
}

function rerender(): void {
  if (mode === "home") renderHome();
  else if (engine) renderWorkout(engine.snapshot());
}

// --- engine wiring ------------------------------------------------------------

function onSnap(snap: EngineSnapshot): void {
  if (snap.status === "active_set") {
    const key = `${snap.exerciseIndex}-${snap.setNumber}`;
    if (key !== lastSetKey) { lastSetKey = key; phase = "ready"; liftElapsed = 0; } // each new set starts on READY
  }
  if (snap.status === "workout_complete" && !savedOnComplete) {
    savedOnComplete = true;
    saveWeightsAndReps(snap);                // weight + rep memory, forward
    saveLastSession(day().plan.title, snap, (snap.card as any).durationMinutes ?? 0);
    if (!endedEarly) markDayDone(dayIndex);  // an early finish saves data but the day isn't "done"
  }
  if (!menuOpen) renderWorkout(snap);
}

function startDay(i: number): void {
  dayIndex = i;
  mode = "workout";
  applySaved();
  repOverride.clear();
  phase = "ready";
  liftElapsed = 0;
  lastSetKey = "";
  savedOnComplete = false;
  endedEarly = false;
  menuOpen = false;
  engine = createWorkoutEngine(day(), { unit: "lb" });
  engine.subscribe(onSnap);
  engine.start();   // -> workout_preview
  engine.next();    // -> straight into the first exercise preview
}

function exitToHome(): void {
  engine = null;
  menuOpen = false;
  mode = "home";
  homeSel = firstUndone();
  renderHome();
}

// --- mid-workout menu (quit early, keep what you did) ------------------------

function renderMenu(): void {
  topEl.textContent = esc(day().plan.title);
  cardEl.innerHTML =
    `<div class="dim">MENU</div>` +
    MENU.map((m, i) => `<div class="menuitem${i === menuSel ? " sel" : ""}">${esc(m)}</div>`).join("");
  hintEl.textContent = "swipe ↑↓ · pinch to choose";
}
function openMenu(): void { menuOpen = true; menuSel = 0; renderMenu(); }
function closeMenu(): void { menuOpen = false; if (engine) renderWorkout(engine.snapshot()); }
function selectMenu(): void {
  if (menuSel === 0) { closeMenu(); return; }                 // Resume
  if (menuSel === 1) {                                         // Finish & save
    menuOpen = false;
    endedEarly = true;
    engine?.end();   // logs the sets done so far -> workout_complete -> onSnap saves them
    return;
  }
  exitToHome();                                               // Discard
}

function adjustWeight(delta: number): void {
  if (!engine || phase !== "ready") return;
  const cur = (engine.snapshot().card as any).targetWeight ?? 0;
  engine.setWeightOverride(Math.max(0, cur + delta)); // notifies -> re-render
}
function adjustReps(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  const s = stepAt(snap.exerciseIndex);
  if (!s) return;
  const base = repOverride.get(s.step.id) ?? (snap.card as any).targetReps ?? 0;
  repOverride.set(s.step.id, Math.max(1, base + delta));
  renderWorkout(snap); // app-level change; engine doesn't notify
}

function moveSel(dir: "left" | "right" | "up" | "down"): void {
  const n = WORKOUTS.length;
  let i = homeSel;
  const col = i % COLS;
  if (dir === "left" && col > 0) i -= 1;
  else if (dir === "right" && col < COLS - 1 && i + 1 < n) i += 1;
  else if (dir === "up" && i - COLS >= 0) i -= COLS;
  else if (dir === "down" && i + COLS < n) i += COLS;
  if (i !== homeSel) { homeSel = i; renderHome(); }
}

// One-second clock: the count-up stopwatch while lifting, else the engine's
// rest countdown.
setInterval(() => {
  if (mode !== "workout" || !engine) return;
  if (engine.snapshot().status === "active_set") {
    if (phase === "lifting") { liftElapsed += 1; renderWorkout(engine.snapshot()); }
  } else {
    engine.tick();
  }
}, 1000);

// --- Neural Band input --------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (mode === "home") {
    switch (e.key) {
      case "ArrowLeft": moveSel("left"); break;
      case "ArrowRight": moveSel("right"); break;
      case "ArrowUp": moveSel("up"); break;
      case "ArrowDown": moveSel("down"); break;
      case "Enter": startDay(homeSel); break;
      default: return;
    }
    e.preventDefault();
    return;
  }

  if (!engine) return;
  if (menuOpen) {
    switch (e.key) {
      case "ArrowUp": menuSel = (menuSel - 1 + MENU.length) % MENU.length; renderMenu(); break;
      case "ArrowDown": menuSel = (menuSel + 1) % MENU.length; renderMenu(); break;
      case "Enter": selectMenu(); break;
      case "Escape": closeMenu(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }
  const snap = engine.snapshot();
  const st = snap.status;
  switch (e.key) {
    case "Enter":
      if (st === "exercise_preview") engine.startSet();
      else if (st === "active_set") {
        if (phase === "ready") { phase = "lifting"; liftElapsed = 0; renderWorkout(snap); }
        else {
          const s = stepAt(snap.exerciseIndex);
          const reps = (s ? repOverride.get(s.step.id) : undefined) ?? (snap.card as any).targetReps;
          engine.completeSet({ weight: (snap.card as any).targetWeight, reps, durationSeconds: liftElapsed });
        }
      }
      else if (st === "resting" || st === "exercise_complete") engine.skipRest();
      else if (st === "workout_complete") exitToHome();
      break;
    case "Escape": // middle-finger pinch = open the quit/save menu
      if (st === "workout_complete") exitToHome();
      else openMenu();
      break;
    case "ArrowLeft":
      if (st === "active_set") adjustWeight(-WEIGHT_STEP);
      else if (st === "exercise_preview") engine.previous();
      break;
    case "ArrowRight":
      if (st === "active_set") adjustWeight(WEIGHT_STEP);
      break;
    case "ArrowUp":
      if (st === "active_set") adjustReps(1);
      else if (st === "resting" || st === "exercise_complete") engine.addSet();
      break;
    case "ArrowDown":
      if (st === "active_set") adjustReps(-1);
      break;
    default:
      return;
  }
  e.preventDefault();
});

// --- boot ---------------------------------------------------------------------

applySaved();
homeSel = firstUndone();
renderHome();
