// SetFlow for the glasses (on-lens Web App). Runs the REAL shared
// workout-engine and renders at 600x600. Input is the Neural Band: swipes
// arrive as arrow keys, index pinch as Enter, middle-finger pinch as Escape
// (per Meta's Web App docs) - the same keys drive it on a desktop for testing.
//
// Flow: HOME (Day 1-5 card grid, cycle tracking) -> pinch -> SUMMARY (every
// exercise for that day, done ones checked off) -> swipe to pick ANY exercise,
// pinch to start it, swipe LEFT to go back and pick a different day -> the set
// flow (READY dial weight/reps -> pinch -> LIFT count-up -> pinch logs the set
// -> REST between sets of the SAME exercise) -> automatically back to SUMMARY
// when that exercise's sets are done -> once every exercise is done, the real
// "Done" screen, and the day dims on the home grid.
//
// Each exercise runs its OWN single-step engine instance (not one engine for
// the whole day) so picking exercises out of order can never falsely trigger
// "workout complete" just because you happened to pick the positionally-last
// one first - completion is tracked by this app from actual logged sets
// (`allResults`), independent of engine internals. Weight AND reps both
// persist across sets, across exercises you revisit, and forward to next
// time. Middle-pinch opens Resume / Finish & save / Discard from anywhere.

import {
  createWorkoutEngine,
  type EngineSetResult,
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
/** Both weight and reps persist forward from whatever was actually logged. */
function saveWeightsAndReps(results: EngineSetResult[]): void {
  try {
    const w = readJson<Record<string, number>>(WEIGHTS_KEY, {});
    const r = readJson<Record<string, number>>(REPS_KEY, {});
    for (const res of results) {
      if (res.status === "skipped") continue;
      const name = exNameForStepId(res.workoutStepId);
      if (!name) continue;
      if (res.actualWeight != null) w[name] = res.actualWeight;
      if (res.actualReps != null) r[name] = res.actualReps;
    }
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w));
    localStorage.setItem(REPS_KEY, JSON.stringify(r));
  } catch { /* storage full - fine */ }
}
function saveLastSession(dayTitle: string, results: EngineSetResult[], durationMin: number): void {
  try {
    const all = readJson<Record<string, LastSession>>(LAST_KEY, {});
    const perExercise: LastSession["perExercise"] = {};
    for (const res of results) {
      if (res.status === "skipped" || res.actualWeight == null) continue;
      const name = exNameForStepId(res.workoutStepId);
      if (name) perExercise[name] = { weight: res.actualWeight, reps: res.actualReps };
    }
    all[dayTitle] = {
      durationMin,
      totalSets: results.filter((r) => r.status === "completed").length,
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
function firstUndoneDay(): number {
  const done = loadCycle();
  const i = done.findIndex((d) => !d);
  return i < 0 ? 0 : i;
}

// --- app state ----------------------------------------------------------------

type Mode = "home" | "summary" | "workout";
type Phase = "ready" | "lifting";
let mode: Mode = "home";
let homeSel = 0;                 // selected day card on the home grid
let dayIndex = 0;                // the day currently open (summary or workout)
let sessionDayIndex: number | null = null; // which day allResults/overrides belong to
let sumSel = 0;                  // selected exercise row on the summary screen
let curExerciseIndex = 0;        // which exercise the live mini-engine represents
let engine: WorkoutEngine | null = null;
let phase: Phase = "ready";      // within a set: dialing in vs actually lifting
let liftElapsed = 0;             // count-up stopwatch (seconds) while lifting
let allResults: EngineSetResult[] = []; // every set logged so far, this day-visit
let dayStartedAtMs: number | null = null;
const weightOverride = new Map<string, number>(); // per step id, this day-visit
const repOverride = new Map<string, number>();    // per step id, this day-visit
let lastSetKey = "";
let menuOpen = false;             // the quit/save menu
let menuSel = 0;
let menuReturnMode: Mode = "summary";
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
function weightForIndex(i: number, fallback?: number): number | undefined {
  const s = stepAt(i);
  if (!s) return fallback;
  return weightOverride.get(s.step.id) ?? fallback;
}
function repsForIndex(i: number, fallback?: number): number | undefined {
  const s = stepAt(i);
  if (!s) return fallback;
  return repOverride.get(s.step.id) ?? fallback;
}
function lastForExercise(dayTitle: string, exName: string) {
  return readJson<Record<string, LastSession>>(LAST_KEY, {})[dayTitle]?.perExercise?.[exName];
}
function splitTitle(title: string): [string, string] {
  const i = title.indexOf("·"); // middle dot in "Day 1 · Push"
  return i < 0 ? [title.trim(), ""] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

/** An exercise counts as done once it has as many logged (non-skipped) sets
 * as its plan calls for - independent of which order exercises were done in. */
function isExerciseDone(stepId: string): boolean {
  const s = day().steps.find((x) => x.step.id === stepId);
  if (!s) return false;
  const logged = allResults.filter((r) => r.workoutStepId === stepId && r.status !== "skipped").length;
  return logged >= s.step.setCount;
}
function allExercisesDone(): boolean {
  return day().steps.every((s) => isExerciseDone(s.step.id));
}
function firstUndoneExercise(): number {
  const i = day().steps.findIndex((s) => !isExerciseDone(s.step.id));
  return i < 0 ? 0 : i;
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

// --- rendering: HOME (day grid) ------------------------------------------------

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

// --- rendering: SUMMARY (every exercise for the day) --------------------------

function renderSummary(): void {
  (progEl as HTMLElement).style.display = "block";
  const steps = day().steps;
  const doneCount = steps.filter((s) => isExerciseDone(s.step.id)).length;
  topEl.textContent = `${esc(day().plan.title)} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);
  const rows = steps.map((s, i) => {
    const done = isExerciseDone(s.step.id);
    const cls = `exrow${done ? " done" : ""}${i === sumSel ? " sel" : ""}`;
    const reps = repsForIndex(i, s.step.targetReps);
    return `<div class="${cls}">${done ? '<span class="check">✔</span>' : ""}` +
      `<div class="en">${esc(s.exercise.name)}</div>` +
      `<div class="es">${s.step.setCount} sets${reps ? ` × ${reps}` : ""}</div></div>`;
  }).join("");
  cardEl.innerHTML = `<div class="exlist">${rows}</div>`;
  hintEl.textContent = "swipe ↑↓ pick exercise · pinch to start · swipe ← back to days";
}

// --- rendering: WORKOUT (inside one exercise) ---------------------------------

function renderWorkout(snap: EngineSnapshot): void {
  (progEl as HTMLElement).style.display = "block";
  const c: any = snap.card;
  const steps = day().steps;
  const doneCount = steps.filter((s) => isExerciseDone(s.step.id)).length;
  topEl.textContent = `${esc(day().plan.title)} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);

  switch (c.kind) {
    case "exercise_preview":
      cardEl.innerHTML =
        `<div class="dim">NEXT UP</div><div class="big">${esc(c.exerciseName)}</div>
         <div class="mid">${c.setCount} sets${c.targetReps ? ` × ${c.targetReps}` : ""} · rest ${c.restSeconds}s</div>`;
      hintEl.textContent = "pinch to set up · swipe ← back to summary";
      break;

    case "active_set": {
      const weight = weightForIndex(curExerciseIndex, c.targetWeight);
      const reps = repsForIndex(curExerciseIndex, c.targetReps);
      const wr = `${weight != null ? `${weight} ${c.unit}` : ""}${weight != null && reps != null ? " × " : ""}${reps ?? ""}`;
      if (phase === "ready") {
        const cue = cueForIndex(curExerciseIndex);
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

    default:
      cardEl.innerHTML = `<div class="mid">${esc(c.exerciseName ?? "")}</div>`;
      hintEl.textContent = "pinch to continue · mid-pinch exit";
  }
}

/** The whole-day finish screen (natural completion or an early "Finish & save"). */
function renderDoneScreen(durationMin: number, early: boolean): void {
  setProgress(1);
  const totalSets = allResults.filter((r) => r.status === "completed").length;
  const steps = day().steps;
  const doneCount = steps.filter((s) => isExerciseDone(s.step.id)).length;
  const last = readJson<Record<string, LastSession>>(LAST_KEY, {})[day().plan.title];
  const cmp = last ? `<div class="tiny">last time: ${last.durationMin} min · ${last.totalSets} sets</div>` : "";
  topEl.textContent = esc(day().plan.title);
  if (early) {
    cardEl.innerHTML =
      `<div class="big">Saved</div>
       <div class="mid">${totalSets} sets · ${durationMin} min · ${doneCount}/${steps.length} exercises</div>
       ${cmp}<div class="dim">Come back anytime</div>`;
  } else {
    cardEl.innerHTML =
      `<div class="big green">✔ Done</div>
       <div class="mid">${totalSets} sets · ${durationMin} min</div>
       ${cmp}<div class="dim">Nice work!</div>`;
  }
  hintEl.textContent = "pinch to return to your days";
}

// --- day / exercise lifecycle --------------------------------------------------

function openDaySummary(i: number): void {
  if (i !== sessionDayIndex) {
    // A different day than whatever was in progress: start it clean.
    allResults = [];
    weightOverride.clear();
    repOverride.clear();
    dayStartedAtMs = Date.now();
    sessionDayIndex = i;
  }
  dayIndex = i;
  applySaved();
  engine = null;
  menuOpen = false;
  mode = "summary";
  sumSel = firstUndoneExercise();
  renderSummary();
}

function startExercise(i: number): void {
  const s = stepAt(i);
  if (!s) return;
  curExerciseIndex = i;
  phase = "ready";
  liftElapsed = 0;
  lastSetKey = "";
  engine = createWorkoutEngine({ plan: day().plan, steps: [s] }, { unit: "lb" });
  engine.subscribe(onExerciseSnap);
  engine.start(); // -> workout_preview (single-step workout)
  engine.next();  // -> exercise_preview
  mode = "workout";
  renderWorkout(engine.snapshot());
}

function onExerciseSnap(snap: EngineSnapshot): void {
  if (snap.status === "active_set") {
    const key = `${snap.setNumber}`;
    if (key !== lastSetKey) { lastSetKey = key; phase = "ready"; liftElapsed = 0; } // each new set starts on READY
  }
  if (snap.status === "workout_complete") {
    // This ONE exercise's sets are all done (each engine wraps a single step,
    // so its own "workout complete" can never be a false positive from
    // picking exercises out of order).
    allResults.push(...snap.results);
    engine = null;
    if (allExercisesDone()) finishDay(false);
    else { mode = "summary"; sumSel = firstUndoneExercise(); renderSummary(); }
    return;
  }
  if (!menuOpen) renderWorkout(snap);
}

function finishDay(early: boolean): void {
  const durationMin = dayStartedAtMs ? Math.max(0, Math.round((Date.now() - dayStartedAtMs) / 60000)) : 0;
  saveWeightsAndReps(allResults);
  saveLastSession(day().plan.title, allResults, durationMin);
  if (!early) markDayDone(dayIndex);
  mode = "workout"; // renderDoneScreen draws into the same #card area
  renderDoneScreen(durationMin, early);
}

function exitToHome(): void {
  engine = null;
  menuOpen = false;
  sessionDayIndex = null; // next time this day (or any) is opened, it starts fresh
  mode = "home";
  homeSel = firstUndoneDay();
  renderHome();
}

// --- mid-session menu (quit early, keep what you did) -------------------------

function renderMenu(): void {
  topEl.textContent = esc(day().plan.title);
  cardEl.innerHTML =
    `<div class="dim">MENU</div>` +
    MENU.map((m, i) => `<div class="menuitem${i === menuSel ? " sel" : ""}">${esc(m)}</div>`).join("");
  hintEl.textContent = "swipe ↑↓ · pinch to choose";
}
function openMenu(): void { menuReturnMode = mode; menuOpen = true; menuSel = 0; renderMenu(); }
function closeMenu(): void {
  menuOpen = false;
  mode = menuReturnMode;
  if (mode === "summary") renderSummary();
  else if (engine) renderWorkout(engine.snapshot());
  else renderSummary();
}
function selectMenu(): void {
  if (menuSel === 0) { closeMenu(); return; }              // Resume
  if (menuSel === 1) {                                      // Finish & save
    menuOpen = false;
    if (engine) allResults.push(...engine.snapshot().results); // keep whatever was logged mid-exercise
    engine = null;
    finishDay(true);
    return;
  }
  exitToHome();                                             // Discard: throw it all away
}

function adjustWeight(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  const cur = weightForIndex(curExerciseIndex, (snap.card as any).targetWeight) ?? 0;
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  weightOverride.set(s.step.id, Math.max(0, cur + delta));
  renderWorkout(snap); // app-level change; engine doesn't track weight display itself
}
function adjustReps(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  const base = repsForIndex(curExerciseIndex, (snap.card as any).targetReps) ?? 0;
  repOverride.set(s.step.id, Math.max(1, base + delta));
  renderWorkout(snap);
}

function moveHomeSel(dir: "left" | "right" | "up" | "down"): void {
  const n = WORKOUTS.length;
  let i = homeSel;
  const col = i % COLS;
  if (dir === "left" && col > 0) i -= 1;
  else if (dir === "right" && col < COLS - 1 && i + 1 < n) i += 1;
  else if (dir === "up" && i - COLS >= 0) i -= COLS;
  else if (dir === "down" && i + COLS < n) i += COLS;
  if (i !== homeSel) { homeSel = i; renderHome(); }
}

// One-second clock: the count-up stopwatch while lifting, else the current
// exercise engine's own rest countdown (between sets of the same exercise).
setInterval(() => {
  if (mode !== "workout" || !engine) return;
  if (engine.snapshot().status === "active_set") {
    if (phase === "lifting") { liftElapsed += 1; renderWorkout(engine.snapshot()); }
  } else if (engine.snapshot().status === "resting") {
    engine.tick();
  }
}, 1000);

// --- Neural Band input --------------------------------------------------------

document.addEventListener("keydown", (e) => {
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

  if (mode === "home") {
    switch (e.key) {
      case "ArrowLeft": moveHomeSel("left"); break;
      case "ArrowRight": moveHomeSel("right"); break;
      case "ArrowUp": moveHomeSel("up"); break;
      case "ArrowDown": moveHomeSel("down"); break;
      case "Enter": openDaySummary(homeSel); break;
      default: return;
    }
    e.preventDefault();
    return;
  }

  if (mode === "summary") {
    const n = day().steps.length;
    switch (e.key) {
      case "ArrowUp": sumSel = Math.max(0, sumSel - 1); renderSummary(); break;
      case "ArrowDown": sumSel = Math.min(n - 1, sumSel + 1); renderSummary(); break;
      case "ArrowLeft": exitToHome(); break;
      case "Enter": startExercise(sumSel); break;
      case "Escape": openMenu(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }

  // mode === "workout"
  if (!engine) {
    // On the whole-day Done screen: pinch returns home.
    if (e.key === "Enter") exitToHome();
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
          const weight = weightForIndex(curExerciseIndex, (snap.card as any).targetWeight);
          const reps = repsForIndex(curExerciseIndex, (snap.card as any).targetReps);
          engine.completeSet({ weight, reps, durationSeconds: liftElapsed });
        }
      }
      else if (st === "resting") engine.skipRest();
      break;
    case "Escape": // middle-finger pinch = open the quit/save menu
      openMenu();
      break;
    case "ArrowLeft":
      if (st === "active_set") adjustWeight(-WEIGHT_STEP);
      else if (st === "exercise_preview") { engine = null; mode = "summary"; renderSummary(); }
      break;
    case "ArrowRight":
      if (st === "active_set") adjustWeight(WEIGHT_STEP);
      break;
    case "ArrowUp":
      if (st === "active_set") adjustReps(1);
      else if (st === "resting") engine.addSet();
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
homeSel = firstUndoneDay();
renderHome();
