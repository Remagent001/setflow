// SetFlow for the glasses (on-lens Web App). Runs the REAL shared
// workout-engine and renders at 600x600. Input is the Neural Band: swipes
// arrive as arrow keys, index pinch as Enter, middle-finger pinch as Escape
// (per Meta's Web App docs) - the same keys drive it on a desktop for testing.
//
// The plan is now LIVE from the cloud: the glasses pair to a SetFlow account
// with a device token in their URL (?t=...), pull that account's workouts, and
// push finished sets back so they land in the web History/Reports. Everything
// is offline-first - the plan renders from a local cache instantly and finished
// workouts queue in an outbox that flushes when there's a connection. (See
// sync.ts. Keith's real workouts are no longer baked into this public file.)
//
// Flow: HOME (day card grid, cycle tracking) -> pinch -> SUMMARY (every
// exercise for that day, done ones checked off) -> swipe to pick ANY exercise,
// pinch to start it, swipe LEFT to go back and pick a different day -> the set
// flow (READY dial weight/reps -> pinch -> LIFT count-up -> pinch logs the set
// -> REST between sets of the SAME exercise) -> automatically back to SUMMARY
// when that exercise's sets are done -> once every exercise is done, the
// "Done" screen (which also queues the session for sync), and the day dims.
//
// Each exercise runs its OWN single-step engine instance (not one engine for
// the whole day) so picking exercises out of order can never falsely trigger
// "workout complete" just because you happened to pick the positionally-last
// one first - completion is tracked by this app from actual logged sets
// (`allResults`), independent of engine internals. Middle-pinch opens
// Resume / Finish & save / Discard from anywhere.

import {
  createWorkoutEngine,
  type EngineSetResult,
  type EngineSnapshot,
  type EngineWorkout,
  type WorkoutEngine,
} from "../../../packages/workout-engine/src/engine.ts";
import {
  clearTokenAndPlan,
  enqueueSession,
  fetchPlan,
  flushOutbox,
  getToken,
  isConfigured,
  loadCachedPlan,
  newClientId,
  outboxCount,
  type SyncBundle,
} from "./sync.ts";

// --- workouts: LIVE from the cloud, cached locally --------------------------

let WORKOUTS: EngineWorkout[] = [];
let token: string | null = null;
let planFromCloud = false; // true once a real (non-empty) plan is loaded

const WEIGHT_STEP = 5; // lbs per swipe
const COLS = 2;        // day-grid columns

// --- persisted state (5MB localStorage is available to Web Apps) -------------

const WEIGHTS_KEY = "setflow-weights"; // { [exerciseName]: number }
const REPS_KEY = "setflow-reps";       // { [exerciseName]: number }
const LAST_KEY = "setflow-last";       // { [dayTitle]: LastSession }
const CYCLE_KEY = "setflow-cycle";     // boolean[] — days done this cycle
const CHECKPOINT_KEY = "sf.progress";  // in-flight day, survives reload/nav
const CHECKPOINT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h - stale checkpoints expire

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

type Mode = "home" | "summary" | "workout" | "blocked";
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

/** One-line sync state for the home screen. */
function syncLine(): string {
  const pending = outboxCount();
  if (pending > 0) return `⟳ ${pending} workout${pending === 1 ? "" : "s"} waiting to sync`;
  return "✓ synced";
}

// --- rendering: connection / pairing screens ---------------------------------

function renderPairScreen(revoked = false): void {
  mode = "blocked";
  (progEl as HTMLElement).style.display = "none";
  setProgress(0);
  topEl.textContent = "SetFlow";
  cardEl.innerHTML = revoked
    ? `<div class="big">Not connected</div>
       <div class="mid">This glasses link was turned off.</div>
       <div class="dim">Open SetFlow on your phone → Settings → Glasses → make a new link.</div>`
    : `<div class="big">Let's pair up</div>
       <div class="mid">Open SetFlow on your phone or PC</div>
       <div class="dim">Settings → Glasses → "Connect your glasses", then open that link here.</div>`;
  hintEl.textContent = "setflow-xi.vercel.app";
}

function renderConnecting(): void {
  mode = "blocked";
  (progEl as HTMLElement).style.display = "none";
  topEl.textContent = "SetFlow";
  cardEl.innerHTML = `<div class="big">Loading…</div><div class="dim">Getting your workouts</div>`;
  hintEl.textContent = "";
}

function renderOfflineNoCache(): void {
  mode = "blocked";
  (progEl as HTMLElement).style.display = "none";
  topEl.textContent = "SetFlow";
  cardEl.innerHTML =
    `<div class="big">Can't reach the cloud</div>
     <div class="mid">Move closer to your phone and try again.</div>`;
  hintEl.textContent = "it'll load automatically once you're back online";
}

// --- rendering: HOME (day grid) ------------------------------------------------

function renderHome(): void {
  mode = "home";
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
  cardEl.innerHTML = `<div class="grid">${cards}</div><div class="tiny synced">${esc(syncLine())}</div>`;
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

// --- in-progress checkpoint (survives reload + swipe-back-to-days) ------------
// The live day (logged sets + weight/rep overrides + start time) is memory-only
// until finishDay uploads it, so a reload or navigating away would lose it.
// We snapshot it to localStorage on every change and restore it when the same
// day is re-opened within 6h.

type Checkpoint = {
  dayIndex: number;
  dayStartedAtMs: number | null;
  results: EngineSetResult[];
  weights: [string, number][];
  reps: [string, number][];
  savedAt: number;
};
function saveCheckpoint(): void {
  if (sessionDayIndex == null) return;
  try {
    const cp: Checkpoint = {
      dayIndex: sessionDayIndex,
      dayStartedAtMs,
      results: allResults,
      weights: [...weightOverride.entries()],
      reps: [...repOverride.entries()],
      savedAt: Date.now(),
    };
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
  } catch { /* storage full - fine */ }
}
function loadCheckpoint(): Checkpoint | null {
  const cp = readJson<Checkpoint | null>(CHECKPOINT_KEY, null);
  if (!cp || typeof cp.dayIndex !== "number") return null;
  if (Date.now() - (cp.savedAt ?? 0) > CHECKPOINT_MAX_AGE_MS) { clearCheckpoint(); return null; }
  return cp;
}
function clearCheckpoint(): void {
  try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* fine */ }
}
function restoreFromCheckpoint(cp: Checkpoint): void {
  sessionDayIndex = cp.dayIndex;
  dayStartedAtMs = cp.dayStartedAtMs ?? Date.now();
  allResults = Array.isArray(cp.results) ? cp.results : [];
  weightOverride.clear();
  for (const [k, v] of cp.weights ?? []) weightOverride.set(k, v);
  repOverride.clear();
  for (const [k, v] of cp.reps ?? []) repOverride.set(k, v);
}
/** Wipe the live day from memory and disk (Discard, or after a synced finish). */
function clearSession(): void {
  allResults = [];
  weightOverride.clear();
  repOverride.clear();
  sessionDayIndex = null;
  dayStartedAtMs = null;
  clearCheckpoint();
}

// --- day / exercise lifecycle --------------------------------------------------

function openDaySummary(i: number): void {
  const cp = loadCheckpoint();
  if (sessionDayIndex === i) {
    // Already the in-progress day in memory - resume as-is.
  } else if (cp && cp.dayIndex === i && i < WORKOUTS.length) {
    // Re-opening the in-progress day after a reload or a trip back to the
    // day grid - restore the logged sets and overrides.
    restoreFromCheckpoint(cp);
  } else {
    // A different day: start it clean (abandons any other in-progress day).
    allResults = [];
    weightOverride.clear();
    repOverride.clear();
    dayStartedAtMs = Date.now();
    sessionDayIndex = i;
    saveCheckpoint();
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
    saveCheckpoint(); // persist logged sets before doing anything else
    engine = null;
    if (allExercisesDone()) finishDay(false);
    else { mode = "summary"; sumSel = firstUndoneExercise(); renderSummary(); }
    return;
  }
  if (!menuOpen) renderWorkout(snap);
}

function finishDay(early: boolean): void {
  const durationMin = dayStartedAtMs ? Math.max(0, Math.round((Date.now() - dayStartedAtMs) / 60000)) : 0;
  const durationSeconds = dayStartedAtMs ? Math.max(0, Math.round((Date.now() - dayStartedAtMs) / 1000)) : 0;
  saveWeightsAndReps(allResults);
  saveLastSession(day().plan.title, allResults, durationMin);
  if (!early) markDayDone(dayIndex);
  queueSync(durationSeconds);
  clearCheckpoint(); // the day is now in the outbox + local history; done screen still reads memory
  mode = "workout"; // renderDoneScreen draws into the same #card area
  renderDoneScreen(durationMin, early);
}

/** Build a session bundle from what was logged and hand it to the outbox. */
function queueSync(durationSeconds: number): void {
  if (!token || !planFromCloud) return;
  const logs = allResults
    .filter((r) => r.status !== "skipped")
    .map((r) => ({
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
    }));
  if (!logs.length) return;

  // Finishing weight/reps per step -> the plan's new defaults, cloud-side.
  const roll = new Map<string, { targetWeight?: number; targetReps?: number }>();
  for (const r of allResults) {
    if (r.status === "skipped") continue;
    const cur = roll.get(r.workoutStepId) ?? {};
    if (r.actualWeight != null) cur.targetWeight = r.actualWeight;
    if (r.actualReps != null) cur.targetReps = r.actualReps;
    roll.set(r.workoutStepId, cur);
  }

  const bundle: SyncBundle = {
    clientId: newClientId(),
    planId: day().plan.id,
    startedAt: new Date(dayStartedAtMs ?? Date.now()).toISOString(),
    durationSeconds,
    status: "completed",
    logs,
    rollforward: [...roll.entries()].map(([stepId, v]) => ({ stepId, ...v })),
  };
  enqueueSession(bundle);
  void flushAndRefresh();
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
    if (engine) { allResults.push(...engine.snapshot().results); saveCheckpoint(); } // keep mid-exercise sets
    engine = null;
    finishDay(true);
    return;
  }
  clearSession();                                          // Discard: throw it all away
  exitToHome();
}

function adjustWeight(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  const cur = weightForIndex(curExerciseIndex, (snap.card as any).targetWeight) ?? 0;
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  weightOverride.set(s.step.id, Math.max(0, cur + delta));
  saveCheckpoint();
  renderWorkout(snap); // app-level change; engine doesn't track weight display itself
}
function adjustReps(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  const base = repsForIndex(curExerciseIndex, (snap.card as any).targetReps) ?? 0;
  repOverride.set(s.step.id, Math.max(1, base + delta));
  saveCheckpoint();
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
  if (mode !== "workout" || !engine || menuOpen) return; // don't paint over the quit menu
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

  if (mode === "blocked") return; // pair / loading / offline screens ignore input

  if (mode === "home") {
    if (!WORKOUTS.length) return;
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
    // On the whole-day Done screen: pinch clears the finished day and returns home.
    if (e.key === "Enter") { clearSession(); exitToHome(); }
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

// --- cloud plan + sync --------------------------------------------------------

/** Flush the outbox; if the server rejected anything as stale, refetch the
 * plan for next time. Refresh the home sync line if it's showing. */
async function flushAndRefresh(): Promise<void> {
  if (!token) return;
  try {
    const summary = await flushOutbox(token);
    if (summary.deadlettered > 0) {
      try {
        const r = await fetchPlan(token);
        if ("workouts" in r) applyFreshPlan(r.workouts); // clamps homeSel; skips if mid-workout
      } catch { /* offline; try later */ }
    }
    if (mode === "home") renderHome();
  } catch { /* offline; the online listener retries */ }
}

/** Apply a freshly fetched plan, but never yank the ground out from under an
 * in-progress workout - only swap while the user is on home / a blocked screen. */
function applyFreshPlan(workouts: EngineWorkout[]): void {
  planFromCloud = workouts.length > 0;
  if (mode === "workout" || mode === "summary") return; // defer to next boot
  WORKOUTS = workouts;
  applySaved();
  if (WORKOUTS.length) { homeSel = firstUndoneDay(); renderHome(); }
  else renderPairScreen();
}

async function boot(): Promise<void> {
  token = getToken();
  if (!token || !isConfigured()) { renderPairScreen(); return; }

  const cached = loadCachedPlan();
  if (cached) {
    WORKOUTS = cached;
    planFromCloud = true;
    applySaved();
    homeSel = firstUndoneDay();
    renderHome();
  } else {
    renderConnecting();
  }

  try {
    const result = await fetchPlan(token);
    if ("workouts" in result) {
      applyFreshPlan(result.workouts);
    } else if (result.error === "invalid_token") {
      // Token was revoked (or is bad): lock the device out even if a plan was
      // cached, and drop the stale token + plan so it can't keep showing data.
      clearTokenAndPlan();
      token = null;
      WORKOUTS = [];
      planFromCloud = false;
      renderPairScreen(true);
    } else if (!cached) {
      renderOfflineNoCache();
    }
  } catch {
    if (!cached) renderOfflineNoCache();
  }

  void flushAndRefresh();
}

// Retry the initial load / flush the outbox whenever we regain connectivity.
window.addEventListener("online", () => {
  if (!token) return;
  if (!WORKOUTS.length) { void boot(); return; }
  void flushAndRefresh();
});

void boot();
