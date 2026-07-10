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
  rewriteQueuedSession,
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
let curSetOffset = 0;             // sets already logged for the running exercise (resume)
let engineSeen = 0;               // engine results already copied into allResults
let exerciseDoneCard = false;     // showing the "✔ done" rep-fix card
let dayQueued = false;            // the finished day's bundle is already in the outbox
let queuedClientId: string | null = null; // its id, so late rep fixes can rewrite it
let lastDurationMin = 0;          // for the day-done screen after the fix card
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
/** Demo image for an exercise, when one was uploaded on the web (served by
 * glasses_get_plan as exercise.imageUrl; absent on plans cached before then). */
function imageForIndex(i: number): string | undefined {
  const s = stepAt(i);
  return (s?.exercise as { imageUrl?: string } | undefined)?.imageUrl;
}
/** Adjust the reps of the most recently logged set ("went over by a couple").
 * Mid-day it re-checkpoints; after the day was finished+queued it rewrites the
 * still-held bundle in the outbox instead (best-effort once uploading starts). */
function amendLastReps(delta: number): void {
  const last = allResults[allResults.length - 1];
  if (!last || last.status === "skipped") return;
  const cur = last.actualReps ?? last.targetReps ?? 0;
  last.actualReps = Math.max(0, cur + delta);
  if (dayQueued) {
    if (queuedClientId) rewriteQueuedSession(queuedClientId, buildBundleParts());
    saveWeightsAndReps(allResults); // keep the rolled-forward rep memory in step too
  } else {
    saveCheckpoint();
  }
}
function lastLoggedLine(): string {
  const last = allResults[allResults.length - 1];
  if (!last) return "";
  return `logged ${last.actualWeight ?? "—"} × ${last.actualReps ?? "—"}`;
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

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const c = snap.card; // discriminated union: each case below narrows on kind
  const steps = day().steps;
  const doneCount = steps.filter((s) => isExerciseDone(s.step.id)).length;
  topEl.textContent = `${esc(day().plan.title)} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);

  switch (c.kind) {
    case "exercise_preview": {
      const img = imageForIndex(curExerciseIndex);
      cardEl.innerHTML =
        `<div class="dim">NEXT UP</div><div class="big">${esc(c.exerciseName)}</div>
         ${img ? `<img class="eximg" src="${esc(img)}" alt="" onerror="this.style.display='none'">` : ""}
         <div class="mid">${c.setCount + curSetOffset} sets${c.targetReps ? ` × ${c.targetReps}` : ""} · rest ${c.restSeconds}s</div>`;
      hintEl.textContent = "pinch to set up · swipe ← back to summary";
      break;
    }

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
           <div class="dim">SET ${snap.setNumber + curSetOffset} / ${snap.setCount + curSetOffset} · READY</div>
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

    case "rest": {
      const fixLine = lastLoggedLine();
      // The engine only runs the REMAINING sets after a resume, so its
      // "Set N" label needs the same offset the READY header gets.
      const nextLabel = c.nextLabel.replace(/^Set (\d+)$/, (_, n) => `Set ${Number(n) + curSetOffset}`);
      cardEl.innerHTML =
        `${c.exerciseName ? `<div class="mid">${esc(c.exerciseName)}</div>` : ""}
         <div class="dim">REST</div><div class="huge">${mmss(c.remainingSeconds)}</div>
         <div class="mid">Next: ${esc(nextLabel)}</div>
         ${fixLine ? `<div class="tiny">${esc(fixLine)} · ←→ fix reps</div>` : ""}`;
      hintEl.textContent = "pinch next set · ←→ fix reps · ↑ add set · mid-pinch exit";
      break;
    }

    default: {
      const name = (c as { exerciseName?: string }).exerciseName ?? "";
      cardEl.innerHTML = `<div class="mid">${esc(name)}</div>`;
      hintEl.textContent = "pinch to continue · mid-pinch exit";
    }
  }
}

/** Between-exercises "✔ done" card: a beat to fix the last set's reps before
 * moving on (the last set of an exercise has no rest screen to fix them from). */
function renderExerciseDone(): void {
  const s = stepAt(curExerciseIndex);
  const mine = s ? allResults.filter((r) => r.workoutStepId === s.step.id && r.status !== "skipped") : [];
  const steps = day().steps;
  const doneCount = steps.filter((x) => isExerciseDone(x.step.id)).length;
  (progEl as HTMLElement).style.display = "block";
  topEl.textContent = `${day().plan.title} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);
  const fixLine = lastLoggedLine();
  cardEl.innerHTML =
    `<div class="big green">✔ ${esc(s?.exercise.name ?? "Done")}</div>
     <div class="mid">${mine.length} set${mine.length === 1 ? "" : "s"} logged</div>
     ${fixLine ? `<div class="dim">${esc(fixLine)}</div>` : ""}
     ${dayQueued ? `<div class="tiny">workout saved ✓</div>` : ""}`;
  hintEl.textContent = dayQueued
    ? "←→ fix last set's reps · pinch to finish"
    : "←→ fix last set's reps · pinch to continue";
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
  /** The plan's stable id - plans are matched by THIS on restore, because the
   * cloud orders plans by title and a web-side add/rename/delete would shift
   * indices and resume the sets into the wrong day. */
  planId?: string;
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
      planId: WORKOUTS[sessionDayIndex]?.plan.id,
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
/** Where the checkpoint's day lives in the CURRENT plan list; -1 if gone. */
function checkpointDayIndex(cp: Checkpoint): number {
  if (cp.planId) return WORKOUTS.findIndex((w) => w.plan.id === cp.planId);
  return cp.dayIndex < WORKOUTS.length ? cp.dayIndex : -1; // legacy checkpoints
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
  dayQueued = false;
  queuedClientId = null;
  exerciseDoneCard = false;
  clearCheckpoint();
}

// --- day / exercise lifecycle --------------------------------------------------

function openDaySummary(i: number): void {
  const cp = loadCheckpoint();
  if (sessionDayIndex === i) {
    // Already the in-progress day in memory - resume as-is.
  } else if (cp && checkpointDayIndex(cp) === i) {
    // Re-opening the in-progress day after a reload or a trip back to the
    // day grid - restore the logged sets and overrides (matched by plan id,
    // so web-side plan changes can't shift the sets into another day).
    restoreFromCheckpoint(cp);
    sessionDayIndex = i; // the plan list may have reordered since the save
  } else {
    // A different day: start it clean (abandons any other in-progress day).
    clearSession();
    dayStartedAtMs = Date.now();
    sessionDayIndex = i;
    saveCheckpoint();
  }
  dayIndex = i;
  applySaved();
  engine = null;
  menuOpen = false;
  // Edge: everything was already logged (e.g. the app died in the instant
  // between the last set and the finish work) - finish the day now instead of
  // stranding it in a summary with nothing left to pick.
  if (allResults.length > 0 && !dayQueued && allExercisesDone()) {
    mode = "workout";
    exerciseDoneCard = true;
    finishDay(false, false);
    renderExerciseDone();
    return;
  }
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
  exerciseDoneCard = false;
  // Resume-aware: sets already logged for this exercise (this day-visit,
  // possibly restored from the checkpoint after a reload) are kept. The
  // engine only runs the REMAINING sets; displays and logged set numbers are
  // offset past what's done. Re-picking a finished exercise = one bonus set.
  const logged = allResults.filter((r) => r.workoutStepId === s.step.id && r.status !== "skipped").length;
  curSetOffset = logged;
  engineSeen = 0;
  const remaining = Math.max(1, s.step.setCount - logged);
  engine = createWorkoutEngine(
    { plan: day().plan, steps: [{ ...s, step: { ...s.step, setCount: remaining } }] },
    { unit: "lb" }
  );
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
  // Persist every newly logged set the moment it happens (so leaving the app
  // mid-exercise never loses a set), with set numbers offset past any sets
  // that were already logged before a resume.
  let pushed = false;
  while (engineSeen < snap.results.length) {
    const r = snap.results[engineSeen];
    engineSeen++;
    if (r) { allResults.push({ ...r, setNumber: r.setNumber + curSetOffset }); pushed = true; }
  }
  if (pushed) saveCheckpoint();
  if (snap.status === "workout_complete") {
    // This ONE exercise's sets are all done (each engine wraps a single step,
    // so its own "workout complete" can never be a false positive from
    // picking exercises out of order). Show the "✔ done" card so the last
    // set's reps can still be fixed before moving on. If that was the day's
    // LAST exercise, the day is saved + queued RIGHT NOW (upload held briefly
    // so the fix card can still rewrite the queued bundle) - putting the
    // glasses away without another pinch loses nothing.
    engine = null;
    exerciseDoneCard = true;
    if (allExercisesDone()) finishDay(false, false);
    renderExerciseDone();
    return;
  }
  if (!menuOpen) renderWorkout(snap);
}

/** logs + rollforward derived from allResults (also used to rewrite the
 * queued bundle when reps are fixed on the done card after finishing). */
function buildBundleParts(): Pick<SyncBundle, "logs" | "rollforward"> {
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
  // Finishing weight/reps per step -> the plan's new defaults, cloud-side.
  const roll = new Map<string, { targetWeight?: number; targetReps?: number }>();
  for (const r of allResults) {
    if (r.status === "skipped") continue;
    const cur = roll.get(r.workoutStepId) ?? {};
    if (r.actualWeight != null) cur.targetWeight = r.actualWeight;
    if (r.actualReps != null) cur.targetReps = r.actualReps;
    roll.set(r.workoutStepId, cur);
  }
  return { logs, rollforward: [...roll.entries()].map(([stepId, v]) => ({ stepId, ...v })) };
}

/** Persist + queue the finished day THE MOMENT it ends (never gated behind
 * another pinch - putting the glasses away right after the last set must not
 * lose the workout). `flushNow=false` holds the upload briefly so the done
 * card's rep fixes can still rewrite the queued bundle. */
function finishDay(early: boolean, flushNow = true): void {
  lastDurationMin = dayStartedAtMs ? Math.max(0, Math.round((Date.now() - dayStartedAtMs) / 60000)) : 0;
  const durationSeconds = dayStartedAtMs ? Math.max(0, Math.round((Date.now() - dayStartedAtMs) / 1000)) : 0;
  saveWeightsAndReps(allResults);
  saveLastSession(day().plan.title, allResults, lastDurationMin);
  if (!early) markDayDone(dayIndex);
  queuedClientId = queueSync(durationSeconds);
  dayQueued = true;
  clearCheckpoint(); // the day is now in the outbox + local history
  if (flushNow) void flushAndRefresh();
}

/** Build a session bundle from what was logged and hand it to the outbox.
 * Returns the bundle's clientId (null when there was nothing to sync). */
function queueSync(durationSeconds: number): string | null {
  if (!token || !planFromCloud) return null;
  const parts = buildBundleParts();
  if (!parts.logs.length) return null;
  const bundle: SyncBundle = {
    clientId: newClientId(),
    planId: day().plan.id,
    startedAt: new Date(dayStartedAtMs ?? Date.now()).toISOString(),
    durationSeconds,
    status: "completed",
    ...parts,
  };
  enqueueSession(bundle);
  return bundle.clientId;
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
  else if (exerciseDoneCard) renderExerciseDone();
  else if (engine) renderWorkout(engine.snapshot());
  else renderSummary();
}
function selectMenu(): void {
  if (menuSel === 0) { closeMenu(); return; }              // Resume
  if (menuSel === 1) {                                      // Finish & save
    // Mid-exercise sets are already in allResults (pushed per-set as logged).
    menuOpen = false;
    engine = null;
    exerciseDoneCard = false;
    mode = "workout"; // renderDoneScreen draws into the same #card area
    finishDay(true);
    renderDoneScreen(lastDurationMin, true);
    return;
  }
  clearSession();                                          // Discard: throw it all away
  exitToHome();
}

function adjustWeight(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  if (snap.card.kind !== "active_set") return;
  const cur = weightForIndex(curExerciseIndex, snap.card.targetWeight) ?? 0;
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  weightOverride.set(s.step.id, Math.max(0, cur + delta));
  saveCheckpoint();
  renderWorkout(snap); // app-level change; engine doesn't track weight display itself
}
function adjustReps(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  if (snap.card.kind !== "active_set") return;
  const s = stepAt(curExerciseIndex);
  if (!s) return;
  const base = repsForIndex(curExerciseIndex, snap.card.targetReps) ?? 0;
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
    if (exerciseDoneCard) {
      // The "✔ done" rep-fix card. If it was the day's last exercise the day
      // is ALREADY saved + queued (dayQueued) - continuing just uploads and
      // shows the day summary; nothing is lost if this pinch never comes.
      if (e.key === "ArrowLeft") { amendLastReps(-1); renderExerciseDone(); }
      else if (e.key === "ArrowRight") { amendLastReps(1); renderExerciseDone(); }
      else if (e.key === "Escape" && !dayQueued) openMenu(); // quit menu still reachable mid-day
      else if (e.key === "Enter" || e.key === "Escape") {
        exerciseDoneCard = false;
        if (dayQueued) { void flushAndRefresh(); renderDoneScreen(lastDurationMin, false); }
        else { mode = "summary"; sumSel = firstUndoneExercise(); renderSummary(); }
      }
      e.preventDefault();
      return;
    }
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
      else if (st === "active_set" && snap.card.kind === "active_set") {
        if (phase === "ready") { phase = "lifting"; liftElapsed = 0; renderWorkout(snap); }
        else {
          const weight = weightForIndex(curExerciseIndex, snap.card.targetWeight);
          const reps = repsForIndex(curExerciseIndex, snap.card.targetReps);
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
      else if (st === "resting") { amendLastReps(-1); renderWorkout(engine.snapshot()); }
      else if (st === "exercise_preview") { engine = null; mode = "summary"; renderSummary(); }
      break;
    case "ArrowRight":
      if (st === "active_set") adjustWeight(WEIGHT_STEP);
      else if (st === "resting") { amendLastReps(1); renderWorkout(engine.snapshot()); }
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

/** If a workout was in flight less than 6h ago (phone call, music change, app
 * reload), jump straight back into that day instead of landing on home.
 * Returns true when it resumed. */
function resumeIfInProgress(): boolean {
  if (sessionDayIndex != null) return false; // a live session already owns the screen
  const cp = loadCheckpoint();
  if (!cp) return false;
  if (!Array.isArray(cp.results) || cp.results.length === 0) return false;
  const idx = checkpointDayIndex(cp);
  if (idx < 0) { clearCheckpoint(); return false; } // that plan no longer exists
  openDaySummary(idx); // restores logged sets + overrides from the checkpoint
  return true;
}

/** Apply a freshly fetched plan, but never yank the ground out from under an
 * in-progress workout - only swap while the user is on home / a blocked screen. */
function applyFreshPlan(workouts: EngineWorkout[]): void {
  planFromCloud = workouts.length > 0;
  if (mode === "workout" || mode === "summary") return; // defer to next boot
  WORKOUTS = workouts;
  applySaved();
  if (WORKOUTS.length) {
    if (resumeIfInProgress()) return;
    homeSel = firstUndoneDay();
    renderHome();
  }
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
    if (!resumeIfInProgress()) {
      homeSel = firstUndoneDay();
      renderHome();
    }
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
