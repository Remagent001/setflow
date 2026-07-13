// SetFlow for the glasses (on-lens Web App). Runs the REAL shared
// workout-engine and renders at 600x600. Input is the Neural Band: swipes
// arrive as arrow keys, index pinch as Enter, middle-finger pinch as Escape
// (per Meta's Web App docs) - the same keys drive it on a desktop for testing.
//
// v3 SESSION MODEL: a workout session = one GYM VISIT, not one plan-day.
// Keith can mix exercises from any day (or browse by muscle group); everything
// he logs stays in ONE open session, shaded/checked in every view, and nothing
// resets until he explicitly ENDs the workout from the mid-pinch menu (or a
// stale session auto-finalizes on a later boot - logged sets are never
// deleted). Every logged set checkpoints to localStorage instantly, so
// leaving the app (phone call, music, football score), battery death, or an
// accidental exit never loses progress. Workout duration counts ACTIVE time
// (gaps over 5 minutes don't inflate it).
//
// The plan is LIVE from the cloud: the glasses pair to a SetFlow account with
// a device token in their URL (?t=...), pull that account's workouts, and push
// finished sessions back so they land in the web History/Reports. Offline-
// first: cached plan renders instantly; finished sessions queue in an outbox
// that flushes on reconnect. (See sync.ts.)
//
// Each exercise runs its OWN single-step engine instance over only its
// REMAINING sets (resume-aware; set numbers are offset), so picking exercises
// in any order - or re-picking one for a bonus set - always displays and logs
// correctly. Completion is tracked by this app from actual logged sets
// (`allResults`), independent of engine internals.

import {
  createWorkoutEngine,
  type EngineSetResult,
  type EngineSnapshot,
  type EngineWorkout,
  type WorkoutEngine,
} from "../../../packages/workout-engine/src/engine.ts";
import {
  archiveUnsyncable,
  clearTokenAndPlan,
  deadletterCount,
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

const WEIGHT_STEP = 5; // lbs per swipe
const COLS = 2;        // day-grid columns

// --- persisted state (5MB localStorage is available to Web Apps) -------------

const WEIGHTS_KEY = "setflow-weights";   // { [exerciseName]: number }
const REPS_KEY = "setflow-reps";         // { [exerciseName]: number }
const LASTEX_KEY = "setflow-lastex";     // { [exerciseName]: {weight,reps,when} }
const LASTSESH_KEY = "setflow-lastsesh"; // { durationMin, totalSets, when }
const LEGACY_LAST_KEY = "setflow-last";  // v2: { [dayTitle]: LastSession } - migrated
const CYCLE_KEY = "setflow-cycle";       // boolean[] — days done this cycle
const CHECKPOINT_KEY = "sf.progress";    // the open session, survives anything
const STALE_SESSION_MS = 6 * 60 * 60 * 1000; // >6h old -> auto-finalize on boot
const ACTIVE_GAP_CAP_MS = 5 * 60 * 1000;     // gaps beyond this don't count as training

type LastExercise = { weight?: number; reps?: number; when: number };
type LastSession = { durationMin: number; totalSets: number; when: number };

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full - fine */ }
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
  } catch { /* fine */ }
}
/** Per-exercise "vs last time", flat by exercise name (sessions span days). */
function saveLastExercises(results: EngineSetResult[]): void {
  const all = readJson<Record<string, LastExercise>>(LASTEX_KEY, {});
  for (const res of results) {
    if (res.status === "skipped" || res.actualWeight == null) continue;
    const name = exNameForStepId(res.workoutStepId);
    if (name) all[name] = { weight: res.actualWeight, reps: res.actualReps, when: Date.now() };
  }
  writeJson(LASTEX_KEY, all);
}
function lastForExercise(exName: string): LastExercise | undefined {
  return readJson<Record<string, LastExercise>>(LASTEX_KEY, {})[exName];
}
/** One-time migration of the v2 per-day store into the flat per-exercise one. */
function migrateLegacyLast(): void {
  const legacy = readJson<Record<string, { perExercise?: Record<string, { weight?: number; reps?: number }>; when?: number }> | null>(LEGACY_LAST_KEY, null);
  if (!legacy) return;
  const flat = readJson<Record<string, LastExercise>>(LASTEX_KEY, {});
  for (const day of Object.values(legacy)) {
    for (const [name, v] of Object.entries(day.perExercise ?? {})) {
      const when = day.when ?? 0;
      if (!flat[name] || flat[name]!.when < when) flat[name] = { ...v, when };
    }
  }
  writeJson(LASTEX_KEY, flat);
  try { localStorage.removeItem(LEGACY_LAST_KEY); } catch { /* fine */ }
}
function loadCycle(): boolean[] {
  const arr = readJson<boolean[]>(CYCLE_KEY, []);
  return WORKOUTS.map((_, i) => Boolean(arr[i]));
}
function markDayDone(i: number): void {
  const done = loadCycle();
  done[i] = true;
  if (done.every(Boolean)) done.fill(false); // whole cycle finished -> fresh week
  writeJson(CYCLE_KEY, done);
}
function firstUndoneDay(): number {
  const done = loadCycle();
  const i = done.findIndex((d) => !d);
  return i < 0 ? 0 : i;
}

// --- app state ----------------------------------------------------------------

type Mode = "home" | "muscles" | "mlist" | "summary" | "workout" | "blocked";
type Phase = "ready" | "lifting";
type CameFrom = "summary" | "mlist";
let mode: Mode = "home";
let homeSel = 0;                 // selected cell on home (0..N-1 days, N = By muscle)
let dayIndex = 0;                // the day currently open in the summary view
let mgSel = 0;                   // selected muscle group
let mlSel = 0;                   // selected exercise within the group
let cameFrom: CameFrom = "summary"; // where the running exercise was started from
let curDayIdx = 0;               // day of the running exercise (may differ from dayIndex)
let curExIdx = 0;                // exercise index within that day
let engine: WorkoutEngine | null = null;
let phase: Phase = "ready";      // within a set: dialing in vs actually lifting
let liftElapsed = 0;             // count-up stopwatch (seconds) while lifting
let lastSetKey = "";
let curSetOffset = 0;            // sets already logged for the running exercise
let engineSeen = 0;              // engine results already copied into allResults
let exerciseDoneCard = false;    // the "✔ done" fix/add-set card
let endScreen = false;           // the post-END summary screen
let menuOpen = false;
let menuSel = 0;
let menuReturnMode: Mode = "home";
const MENU = ["Resume", "Back to menu", "End workout", "Discard workout"];

// The open SESSION (one gym visit): every set logged since the last END.
let allResults: EngineSetResult[] = [];
const weightOverride = new Map<string, number>(); // per step id, this session
const repOverride = new Map<string, number>();    // per step id, this session
let sessionStartedAtMs: number | null = null;
let activeMs = 0;                 // accumulated ACTIVE time (gaps >5min excluded)
let lastActivityAt: number | null = null;

function day(): EngineWorkout { return WORKOUTS[dayIndex]!; }
function stepAt(dayIdx: number, exIdx: number) { return WORKOUTS[dayIdx]?.steps[exIdx]; }
function curStep() { return stepAt(curDayIdx, curExIdx); }
function stepById(id: string) {
  for (const w of WORKOUTS) { const s = w.steps.find((x) => x.step.id === id); if (s) return s; }
  return undefined;
}
function exNameForStepId(id: string): string | undefined {
  return stepById(id)?.exercise.name;
}
function splitTitle(title: string): [string, string] {
  const i = title.indexOf("·"); // middle dot in "Day 1 · Push"
  return i < 0 ? [title.trim(), ""] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}
/** Demo image for an exercise, when one was uploaded on the web. */
function imageFor(dayIdx: number, exIdx: number): string | undefined {
  const s = stepAt(dayIdx, exIdx);
  return (s?.exercise as { imageUrl?: string } | undefined)?.imageUrl;
}
function weightFor(stepId: string, fallback?: number): number | undefined {
  return weightOverride.get(stepId) ?? fallback;
}
function repsFor(stepId: string, fallback?: number): number | undefined {
  return repOverride.get(stepId) ?? fallback;
}

/** An exercise counts as done once it has as many logged (non-skipped) sets
 * this SESSION as its plan calls for - regardless of entry path or order. */
function loggedCountFor(stepId: string): number {
  return allResults.filter((r) => r.workoutStepId === stepId && r.status !== "skipped").length;
}
function isExerciseDone(stepId: string): boolean {
  const s = stepById(stepId);
  if (!s) return false;
  return loggedCountFor(stepId) >= s.step.setCount;
}
/** Name-aware done check for the muscle views: the same movement can appear in
 * several days (different step ids); the muscle list dedupes by NAME, so its
 * shading must count sets logged under ANY of that movement's step ids. */
function loggedCountForName(exName: string): number {
  const stepIds = new Set<string>();
  for (const w of WORKOUTS) for (const s of w.steps) {
    if (s.exercise.name === exName) stepIds.add(s.step.id);
  }
  return allResults.filter((r) => stepIds.has(r.workoutStepId) && r.status !== "skipped").length;
}
function isMuscleItemDone(item: { name: string; stepId: string }): boolean {
  const s = stepById(item.stepId);
  if (!s) return false;
  return loggedCountForName(item.name) >= s.step.setCount;
}
function dayDoneCount(i: number): number {
  return WORKOUTS[i]?.steps.filter((s) => isExerciseDone(s.step.id)).length ?? 0;
}
function sessionActive(): boolean { return allResults.length > 0; }
function sessionSetCount(): number {
  return allResults.filter((r) => r.status !== "skipped").length;
}

/** Fold the time since the last activity into the session's active clock.
 * The clock only runs once a session actually exists (≥1 logged set) - just
 * browsing exercises without lifting doesn't start a phantom workout. */
function touchActivity(): void {
  const now = Date.now();
  if (!sessionActive()) { lastActivityAt = now; return; }
  if (sessionStartedAtMs == null) sessionStartedAtMs = now;
  if (lastActivityAt != null) activeMs += Math.min(Math.max(0, now - lastActivityAt), ACTIVE_GAP_CAP_MS);
  lastActivityAt = now;
}

// --- the session checkpoint (survives reload / battery / accidental exit) -----

type Checkpoint = {
  v: 3;
  results: EngineSetResult[];
  weights: [string, number][];
  reps: [string, number][];
  startedAtMs: number | null;
  activeMs: number;
  lastDayIndex: number;
  /** Stable id of that day's plan - resume matches by THIS (the cloud orders
   * plans by title, so web-side changes can shift indices). */
  lastPlanId?: string;
  savedAt: number;
};
function saveCheckpoint(): void {
  // Persist when there are logged sets, OR when weights/reps were dialed in
  // before the first set (losing the dial-in on a reload is annoying too).
  if (!sessionActive() && weightOverride.size === 0 && repOverride.size === 0) return;
  touchActivity();
  const cp: Checkpoint = {
    v: 3,
    results: allResults,
    weights: [...weightOverride.entries()],
    reps: [...repOverride.entries()],
    startedAtMs: sessionStartedAtMs,
    activeMs,
    lastDayIndex: dayIndex,
    lastPlanId: WORKOUTS[dayIndex]?.plan.id,
    savedAt: Date.now(),
  };
  writeJson(CHECKPOINT_KEY, cp);
}
/** Any restorable checkpoint, v2 or v3 (staleness is decided by the caller -
 * a stale session is FINALIZED, never thrown away). */
function loadCheckpoint(): Checkpoint | null {
  const raw = readJson<Record<string, unknown> | null>(CHECKPOINT_KEY, null);
  if (!raw || !Array.isArray(raw.results)) return null;
  if ((raw as { v?: number }).v === 3) return raw as unknown as Checkpoint;
  // v2 shape: { dayIndex, planId?, dayStartedAtMs, results, weights, reps, savedAt }
  const legacy = raw as unknown as {
    dayIndex?: number; planId?: string; dayStartedAtMs?: number | null; results: EngineSetResult[];
    weights?: [string, number][]; reps?: [string, number][]; savedAt?: number;
  };
  // Approximate the v2 session's active time from its wall-clock span (capped
  // at 3h) so an auto-finalized pre-upgrade workout doesn't sync as "1 min".
  const span = (legacy.savedAt ?? 0) - (legacy.dayStartedAtMs ?? legacy.savedAt ?? 0);
  return {
    v: 3,
    results: legacy.results,
    weights: legacy.weights ?? [],
    reps: legacy.reps ?? [],
    startedAtMs: legacy.dayStartedAtMs ?? null,
    activeMs: Math.max(0, Math.min(span, 3 * 60 * 60 * 1000)),
    lastDayIndex: legacy.dayIndex ?? 0,
    lastPlanId: legacy.planId,
    savedAt: legacy.savedAt ?? 0,
  };
}
function clearCheckpoint(): void {
  try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* fine */ }
}
function restoreFromCheckpoint(cp: Checkpoint): void {
  allResults = Array.isArray(cp.results) ? cp.results : [];
  weightOverride.clear();
  for (const [k, v] of cp.weights ?? []) weightOverride.set(k, v);
  repOverride.clear();
  for (const [k, v] of cp.reps ?? []) repOverride.set(k, v);
  sessionStartedAtMs = cp.startedAtMs ?? Date.now();
  activeMs = cp.activeMs ?? 0;
  lastActivityAt = null; // the gap while the app was closed doesn't count
}
/** Wipe the open session from memory and disk (Discard, or after END). */
function clearSession(): void {
  allResults = [];
  weightOverride.clear();
  repOverride.clear();
  sessionStartedAtMs = null;
  activeMs = 0;
  lastActivityAt = null;
  exerciseDoneCard = false;
  endScreen = false;
  clearCheckpoint();
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

/** One-line status for the home screen: open session + sync state. */
function statusLine(): string {
  const bits: string[] = [];
  if (sessionActive()) bits.push(`workout in progress · ${sessionSetCount()} sets`);
  const pending = outboxCount();
  bits.push(pending > 0 ? `⟳ ${pending} to sync` : "✓ synced");
  const dead = deadletterCount();
  if (dead > 0) bits.push(`⚠ ${dead} couldn't sync`); // archived, not lost - see web
  return bits.join(" · ");
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

// --- rendering: HOME (day grid + By muscle) ------------------------------------

function renderHome(): void {
  mode = "home";
  (progEl as HTMLElement).style.display = "none";
  const done = loadCycle();
  const doneCount = done.filter(Boolean).length;
  topEl.textContent = `This cycle · ${doneCount} of ${WORKOUTS.length} done`;
  const cards = WORKOUTS.map((w, i) => {
    const [dn, dt] = splitTitle(w.plan.title);
    const prog = dayDoneCount(i);
    const cls = `daycard${done[i] ? " done" : ""}${i === homeSel ? " sel" : ""}`;
    const progLine = prog > 0
      ? `<div class="dc green">${prog}/${w.steps.length} done this workout</div>`
      : `<div class="dc">${w.steps.length} exercises</div>`;
    return `<div class="${cls}">${done[i] ? '<span class="check">✔</span>' : ""}` +
      `<div class="dn">${esc(dn)}</div><div class="dt">${esc(dt)}</div>${progLine}</div>`;
  }).join("");
  const mIdx = WORKOUTS.length;
  const muscleCard =
    `<div class="daycard wide${homeSel === mIdx ? " sel" : ""}">` +
    `<div class="dn">💪 By muscle</div><div class="dt">chest · back · legs …</div></div>`;
  cardEl.innerHTML = `<div class="grid">${cards}${muscleCard}</div><div class="tiny synced">${esc(statusLine())}</div>`;
  hintEl.textContent = sessionActive()
    ? "swipe to pick · pinch to open · mid-pinch = end workout"
    : "swipe to pick your day · pinch to start";
}

// --- rendering: BY MUSCLE ------------------------------------------------------

type MuscleItem = { name: string; stepId: string; dayIdx: number; exIdx: number };
function muscleIndex(): { group: string; items: MuscleItem[] }[] {
  const byGroup = new Map<string, MuscleItem[]>();
  const seen = new Set<string>();
  WORKOUTS.forEach((w, di) => w.steps.forEach((s, ei) => {
    if (seen.has(s.exercise.name)) return; // same movement across days = one entry
    seen.add(s.exercise.name);
    const raw = (s.exercise.primaryMuscleGroup ?? "").trim() || "other";
    const group = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push({ name: s.exercise.name, stepId: s.step.id, dayIdx: di, exIdx: ei });
  }));
  return [...byGroup.entries()]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

// Long lists overflow the fixed 600x600 screen. Every render rebuilds the list
// (resetting its scroll), so re-centre the selected row in the window here.
function centerSel(): void {
  const list = cardEl.querySelector(".exlist") as HTMLElement | null;
  const sel = list?.querySelector(".sel") as HTMLElement | null;
  if (!list || !sel || list.scrollHeight <= list.clientHeight) return;
  list.scrollTop = sel.offsetTop - (list.clientHeight - sel.offsetHeight) / 2;
}

function renderMuscles(): void {
  mode = "muscles";
  (progEl as HTMLElement).style.display = "none";
  topEl.textContent = "By muscle";
  const groups = muscleIndex();
  if (!groups.length) { renderHome(); return; }
  mgSel = Math.min(mgSel, groups.length - 1);
  const rows = groups.map((g, i) => {
    const done = g.items.filter((x) => isMuscleItemDone(x)).length;
    const cls = `exrow${i === mgSel ? " sel" : ""}`;
    return `<div class="${cls}"><div class="en">${esc(g.group)}</div>` +
      `<div class="es">${g.items.length} exercise${g.items.length === 1 ? "" : "s"}${done ? ` · ${done} done` : ""}</div></div>`;
  }).join("");
  cardEl.innerHTML = `<div class="exlist">${rows}</div>`;
  centerSel();
  hintEl.textContent = "swipe ↑↓ pick muscle · pinch to open · swipe ← back";
}

function renderMList(): void {
  mode = "mlist";
  (progEl as HTMLElement).style.display = "none";
  const groups = muscleIndex();
  const g = groups[Math.min(mgSel, groups.length - 1)];
  if (!g) { renderMuscles(); return; }
  topEl.textContent = g.group; // textContent doesn't parse HTML - no escaping
  mlSel = Math.min(mlSel, g.items.length - 1);
  const rows = g.items.map((x, i) => {
    const s = stepById(x.stepId);
    const done = isMuscleItemDone(x);
    const cls = `exrow${done ? " done" : ""}${i === mlSel ? " sel" : ""}`;
    const reps = s ? repsFor(x.stepId, s.step.targetReps) : undefined;
    return `<div class="${cls}">${done ? '<span class="check">✔</span>' : ""}` +
      `<div class="en">${esc(x.name)}</div>` +
      `<div class="es">${s?.step.setCount ?? "?"} sets${reps ? ` × ${reps}` : ""}</div></div>`;
  }).join("");
  cardEl.innerHTML = `<div class="exlist">${rows}</div>`;
  centerSel();
  hintEl.textContent = "swipe ↑↓ pick exercise · pinch to start · swipe ← back";
}

// --- rendering: DAY SUMMARY ------------------------------------------------------

function renderSummary(): void {
  mode = "summary";
  (progEl as HTMLElement).style.display = "block";
  const steps = day().steps;
  const doneCount = dayDoneCount(dayIndex);
  topEl.textContent = `${day().plan.title} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);
  const rows = steps.map((s, i) => {
    const done = isExerciseDone(s.step.id);
    const sel = i === sumSel ? " sel" : "";
    const reps = repsFor(s.step.id, s.step.targetReps);
    return `<div class="exrow${done ? " done" : ""}${sel}">${done ? '<span class="check">✔</span>' : ""}` +
      `<div class="en">${esc(s.exercise.name)}</div>` +
      `<div class="es">${s.step.setCount} sets${reps ? ` × ${reps}` : ""}</div></div>`;
  }).join("");
  cardEl.innerHTML = `<div class="exlist">${rows}</div>`;
  centerSel();
  hintEl.textContent = "swipe ↑↓ pick exercise · pinch to start · swipe ← back to menu";
}
let sumSel = 0;

function firstUndoneExercise(): number {
  const i = day().steps.findIndex((s) => !isExerciseDone(s.step.id));
  return i < 0 ? 0 : i;
}

// --- rendering: WORKOUT (inside one exercise) ---------------------------------

function renderWorkout(snap: EngineSnapshot): void {
  (progEl as HTMLElement).style.display = "block";
  const c = snap.card; // discriminated union: each case below narrows on kind
  const d = WORKOUTS[curDayIdx];
  const steps = d?.steps ?? [];
  const doneCount = steps.filter((s) => isExerciseDone(s.step.id)).length;
  topEl.textContent = `${d?.plan.title ?? ""} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);

  switch (c.kind) {
    case "exercise_preview": {
      const img = imageFor(curDayIdx, curExIdx);
      cardEl.innerHTML =
        `<div class="dim">NEXT UP</div><div class="big">${esc(c.exerciseName)}</div>
         ${img ? `<img class="eximg" src="${esc(img)}" alt="" onerror="this.style.display='none'">` : ""}
         <div class="mid">${c.setCount + curSetOffset} sets${c.targetReps ? ` × ${c.targetReps}` : ""} · rest ${c.restSeconds}s</div>`;
      hintEl.textContent = "pinch to set up · swipe ← back";
      break;
    }

    case "active_set": {
      const stepId = curStep()?.step.id ?? "";
      const weight = weightFor(stepId, c.targetWeight);
      const reps = repsFor(stepId, c.targetReps);
      const wr = `${weight != null ? `${weight} ${c.unit}` : ""}${weight != null && reps != null ? " × " : ""}${reps ?? ""}`;
      if (phase === "ready") {
        const cue = curStep()?.step.cue ?? curStep()?.exercise.cues?.[0];
        const last = lastForExercise(c.exerciseName);
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
        hintEl.textContent = "pinch when the set is done · mid-pinch menu";
      }
      break;
    }

    case "rest": {
      const last = allResults[allResults.length - 1];
      const fixLine = last ? `logged ${last.actualWeight ?? "—"} × ${last.actualReps ?? "—"}` : "";
      // The engine only runs the REMAINING sets after a resume, so its
      // "Set N" label needs the same offset the READY header gets.
      const nextLabel = c.nextLabel.replace(/^Set (\d+)$/, (_, n) => `Set ${Number(n) + curSetOffset}`);
      cardEl.innerHTML =
        `${c.exerciseName ? `<div class="mid">${esc(c.exerciseName)}</div>` : ""}
         <div class="dim">REST</div><div class="huge">${mmss(c.remainingSeconds)}</div>
         <div class="mid">Next: ${esc(nextLabel)}</div>
         ${fixLine ? `<div class="tiny">${esc(fixLine)} · ←→ fix reps</div>` : ""}`;
      hintEl.textContent = "pinch next set · ←→ fix reps · mid-pinch menu";
      break;
    }

    default: {
      const name = (c as { exerciseName?: string }).exerciseName ?? "";
      cardEl.innerHTML = `<div class="mid">${esc(name)}</div>`;
      hintEl.textContent = "pinch to continue · mid-pinch menu";
    }
  }
}

/** The "✔ exercise done" card: fix the last set's reps, or add one more set
 * ("done, or one more?"). Purely UI - the sets are already checkpointed. */
function renderExerciseDone(): void {
  const s = curStep();
  const mine = s ? allResults.filter((r) => r.workoutStepId === s.step.id && r.status !== "skipped") : [];
  const last = allResults[allResults.length - 1];
  const d = WORKOUTS[curDayIdx];
  const steps = d?.steps ?? [];
  const doneCount = steps.filter((x) => isExerciseDone(x.step.id)).length;
  (progEl as HTMLElement).style.display = "block";
  topEl.textContent = `${d?.plan.title ?? ""} · ${doneCount}/${steps.length} done`;
  setProgress(steps.length ? doneCount / steps.length : 0);
  cardEl.innerHTML =
    `<div class="big green">✔ ${esc(s?.exercise.name ?? "Done")}</div>
     <div class="mid">${mine.length} set${mine.length === 1 ? "" : "s"} logged</div>
     ${last ? `<div class="dim">last set: ${last.actualWeight ?? "—"} × ${last.actualReps ?? "—"}</div>` : ""}`;
  hintEl.textContent = "↑ one more set · ←→ fix reps · pinch done";
}

/** Post-END screen: the whole session's totals. */
function renderEndScreen(totalSets: number, durationMin: number, prev: LastSession | null): void {
  mode = "workout";
  endScreen = true;
  (progEl as HTMLElement).style.display = "block";
  setProgress(1);
  topEl.textContent = "Workout complete";
  const cmp = prev ? `<div class="tiny">last time: ${prev.durationMin} min · ${prev.totalSets} sets</div>` : "";
  cardEl.innerHTML =
    `<div class="big green">✔ Done</div>
     <div class="mid">${totalSets} sets · ${durationMin} min</div>
     ${cmp}<div class="dim">Nice work!</div>`;
  hintEl.textContent = "pinch to return to your days";
}

// --- exercise lifecycle --------------------------------------------------------

function openDay(i: number): void {
  if (i < 0 || i >= WORKOUTS.length) { goHome(); return; }
  dayIndex = i;
  engine = null;
  menuOpen = false;
  exerciseDoneCard = false;
  sumSel = firstUndoneExercise();
  renderSummary();
}

function goHome(): void {
  engine = null;
  menuOpen = false;
  exerciseDoneCard = false;
  homeSel = sessionActive() ? homeSel : firstUndoneDay();
  if (homeSel > WORKOUTS.length) homeSel = 0;
  renderHome();
}

function startExercise(dayIdx: number, exIdx: number, from: CameFrom): void {
  const s = stepAt(dayIdx, exIdx);
  if (!s) return;
  curDayIdx = dayIdx;
  curExIdx = exIdx;
  cameFrom = from;
  phase = "ready";
  liftElapsed = 0;
  lastSetKey = "";
  exerciseDoneCard = false;
  touchActivity();
  // Resume-aware: sets already logged for this exercise (this session) are
  // kept; the engine only runs the REMAINING sets and displays are offset.
  // Re-picking a finished exercise = one bonus set ("one more?").
  const logged = loggedCountFor(s.step.id);
  curSetOffset = logged;
  engineSeen = 0;
  const remaining = Math.max(1, s.step.setCount - logged);
  engine = createWorkoutEngine(
    { plan: WORKOUTS[dayIdx]!.plan, steps: [{ ...s, step: { ...s.step, setCount: remaining } }] },
    { unit: "lb" }
  );
  engine.subscribe(onExerciseSnap);
  engine.start(); // -> workout_preview (single-step workout)
  engine.next();  // -> exercise_preview
  mode = "workout";
  renderWorkout(engine.snapshot());
}

function backFromExercise(): void {
  engine = null;
  exerciseDoneCard = false;
  if (cameFrom === "mlist") renderMList();
  else openDay(curDayIdx);
}

function onExerciseSnap(snap: EngineSnapshot): void {
  if (snap.status === "active_set") {
    const key = `${snap.setNumber}`;
    if (key !== lastSetKey) { lastSetKey = key; phase = "ready"; liftElapsed = 0; } // each new set starts on READY
  }
  // Persist every newly logged set the moment it happens (battery death,
  // accidental exit, or leaving for a phone call never loses a set), with set
  // numbers offset past any sets logged before a resume.
  let pushed = false;
  while (engineSeen < snap.results.length) {
    const r = snap.results[engineSeen];
    engineSeen++;
    if (r) { allResults.push({ ...r, setNumber: r.setNumber + curSetOffset }); pushed = true; }
  }
  if (pushed) saveCheckpoint();
  if (snap.status === "workout_complete") {
    // This ONE exercise's sets are all done. Show the "✔ done" card: fix reps,
    // add one more set, or continue. The SESSION stays open either way -
    // nothing ends until the END menu action.
    engine = null;
    exerciseDoneCard = true;
    renderExerciseDone();
    return;
  }
  if (!menuOpen) renderWorkout(snap);
}

/** Adjust the reps of the most recently logged set ("went over by a couple"). */
function amendLastReps(delta: number): void {
  const last = allResults[allResults.length - 1];
  if (!last || last.status === "skipped") return;
  const cur = last.actualReps ?? last.targetReps ?? 0;
  last.actualReps = Math.max(0, cur + delta);
  saveCheckpoint();
}

// --- END: finalize the session --------------------------------------------------

/** logs + rollforward derived from the given results (already non-skipped). */
function buildBundlePartsFor(results: EngineSetResult[]): Pick<SyncBundle, "logs" | "rollforward"> {
  const logs = results
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
  const roll = new Map<string, { targetWeight?: number; targetReps?: number }>();
  for (const r of results) {
    if (r.status === "skipped") continue;
    const cur = roll.get(r.workoutStepId) ?? {};
    if (r.actualWeight != null) cur.targetWeight = r.actualWeight;
    if (r.actualReps != null) cur.targetReps = r.actualReps;
    roll.set(r.workoutStepId, cur);
  }
  return { logs, rollforward: [...roll.entries()].map(([stepId, v]) => ({ stepId, ...v })) };
}

/** END workout: persist memories, mark fully-done days on the cycle, queue the
 * visit's logs, then clear the slate so everything un-shades for next time.
 * Logs are queued as ONE BUNDLE PER PLAN touched: the server rejects a whole
 * bundle when any one step in it went stale (edited on the web mid-visit), so
 * splitting by plan caps the blast radius to that plan's own sets. */
function finalizeSession(showScreen: boolean): void {
  if (!sessionActive()) { clearSession(); if (showScreen) goHome(); return; }
  touchActivity();
  const durationMin = Math.max(1, Math.round(activeMs / 60000));
  const totalSets = sessionSetCount();
  const prev = readJson<LastSession | null>(LASTSESH_KEY, null);

  // Group loggable sets by the PLAN owning each step.
  const byPlan = new Map<string, EngineSetResult[]>();
  const orphanLogs: EngineSetResult[] = []; // steps no longer in any plan
  for (const r of allResults) {
    if (r.status === "skipped") continue;
    const w = WORKOUTS.find((wk) => wk.steps.some((s) => s.step.id === r.workoutStepId));
    if (!w) { orphanLogs.push(r); continue; }
    if (!byPlan.has(w.plan.id)) byPlan.set(w.plan.id, []);
    byPlan.get(w.plan.id)!.push(r);
  }

  if (token && byPlan.size === 0 && totalSets > 0) {
    // Nothing attributable to a plan (the plan list changed under us) - keep
    // the session + checkpoint rather than silently dropping logged sets.
    saveCheckpoint();
    if (showScreen) goHome();
    return;
  }

  saveWeightsAndReps(allResults);
  saveLastExercises(allResults);
  writeJson(LASTSESH_KEY, { durationMin, totalSets, when: Date.now() } satisfies LastSession);

  // Any day whose exercises are ALL satisfied by this visit gets its cycle ✔.
  WORKOUTS.forEach((w, i) => {
    if (w.steps.length && w.steps.every((s) => isExerciseDone(s.step.id))) markDayDone(i);
  });

  if (token) {
    const startedAt = new Date(sessionStartedAtMs ?? Date.now()).toISOString();
    const totalLoggable = [...byPlan.values()].reduce((n, l) => n + l.length, 0) || 1;
    for (const [planId, planResults] of byPlan) {
      const parts = buildBundlePartsFor(planResults);
      if (!parts.logs.length) continue;
      // Active time split across the plans' bundles by their share of sets.
      const share = Math.max(1, Math.round((activeMs / 1000) * (planResults.length / totalLoggable)));
      enqueueSession({
        clientId: newClientId(),
        planId,
        startedAt,
        durationSeconds: share,
        status: "completed",
        logs: parts.logs,
        rollforward: parts.rollforward,
      });
    }
    // Steps deleted on the web mid-visit can't sync (no valid step id) -
    // archive them in the dead-letter store instead of losing them silently.
    if (orphanLogs.length) {
      archiveUnsyncable({
        clientId: newClientId(),
        planId: "",
        startedAt,
        durationSeconds: 1,
        status: "completed",
        logs: buildBundlePartsFor(orphanLogs).logs,
        rollforward: [],
      });
    }
  }

  clearSession();
  applySaved(); // rolled-forward weights/reps become the new displayed defaults
  void flushAndRefresh();
  if (showScreen) renderEndScreen(totalSets, durationMin, prev);
}

// --- mid-pinch menu --------------------------------------------------------------

function renderMenu(): void {
  topEl.textContent = sessionActive() ? `Workout · ${sessionSetCount()} sets so far` : "Menu";
  cardEl.innerHTML =
    `<div class="dim">MENU</div>` +
    MENU.map((m, i) => `<div class="menuitem${i === menuSel ? " sel" : ""}">${esc(m)}</div>`).join("");
  hintEl.textContent = "swipe ↑↓ · pinch to choose";
}
function openMenu(): void { menuReturnMode = mode; menuOpen = true; menuSel = 0; renderMenu(); }
function closeMenu(): void {
  menuOpen = false;
  mode = menuReturnMode;
  if (mode === "home") renderHome();
  else if (mode === "muscles") renderMuscles();
  else if (mode === "mlist") renderMList();
  else if (mode === "summary") renderSummary();
  else if (exerciseDoneCard) renderExerciseDone();
  else if (engine) renderWorkout(engine.snapshot());
  else goHome();
}
function selectMenu(): void {
  if (menuSel === 0) { closeMenu(); return; }               // Resume
  if (menuSel === 1) { menuOpen = false; goHome(); return; } // Back to menu (session stays open)
  if (menuSel === 2) {                                       // End workout (save & sync)
    menuOpen = false;
    engine = null;
    exerciseDoneCard = false;
    finalizeSession(true);
    return;
  }
  menuOpen = false;                                          // Discard everything
  clearSession();
  goHome();
}

function adjustWeight(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  if (snap.card.kind !== "active_set") return;
  const s = curStep();
  if (!s) return;
  const cur = weightFor(s.step.id, snap.card.targetWeight) ?? 0;
  weightOverride.set(s.step.id, Math.max(0, cur + delta));
  saveCheckpoint();
  renderWorkout(snap); // app-level change; engine doesn't track weight display itself
}
function adjustReps(delta: number): void {
  if (!engine || phase !== "ready") return;
  const snap = engine.snapshot();
  if (snap.card.kind !== "active_set") return;
  const s = curStep();
  if (!s) return;
  const base = repsFor(s.step.id, snap.card.targetReps) ?? 0;
  repOverride.set(s.step.id, Math.max(1, base + delta));
  saveCheckpoint();
  renderWorkout(snap);
}

function moveHomeSel(dir: "left" | "right" | "up" | "down"): void {
  const n = WORKOUTS.length; // cells 0..n-1 are days; cell n = "By muscle"
  let i = homeSel;
  if (i === n) {
    // On the full-width muscle card: up goes back into the grid.
    if (dir === "up" && n > 0) i = n - 1;
  } else {
    const col = i % COLS;
    if (dir === "left" && col > 0) i -= 1;
    else if (dir === "right" && col < COLS - 1 && i + 1 < n) i += 1;
    else if (dir === "up" && i - COLS >= 0) i -= COLS;
    else if (dir === "down") i = i + COLS < n ? i + COLS : n; // fall through to the muscle card
  }
  if (i !== homeSel) { homeSel = i; renderHome(); }
}

// One-second clock: the count-up stopwatch while lifting, else the current
// exercise engine's own rest countdown (between sets of the same exercise).
setInterval(() => {
  if (mode !== "workout" || !engine || menuOpen) return; // don't paint over the menu
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
      case "Enter":
        if (homeSel === WORKOUTS.length) { mgSel = 0; renderMuscles(); }
        else openDay(homeSel);
        break;
      case "Escape": if (sessionActive()) openMenu(); break; // END reachable from the intro
      default: return;
    }
    e.preventDefault();
    return;
  }

  if (mode === "muscles") {
    const groups = muscleIndex();
    switch (e.key) {
      case "ArrowUp": mgSel = Math.max(0, mgSel - 1); renderMuscles(); break;
      case "ArrowDown": mgSel = Math.min(groups.length - 1, mgSel + 1); renderMuscles(); break;
      case "ArrowLeft": goHome(); break;
      case "Enter": mlSel = 0; renderMList(); break;
      case "Escape": if (sessionActive()) openMenu(); else goHome(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }

  if (mode === "mlist") {
    const groups = muscleIndex();
    const items = groups[Math.min(mgSel, groups.length - 1)]?.items ?? [];
    switch (e.key) {
      case "ArrowUp": mlSel = Math.max(0, mlSel - 1); renderMList(); break;
      case "ArrowDown": mlSel = Math.min(items.length - 1, mlSel + 1); renderMList(); break;
      case "ArrowLeft": renderMuscles(); break;
      case "Enter": {
        const item = items[mlSel];
        if (item) startExercise(item.dayIdx, item.exIdx, "mlist");
        break;
      }
      case "Escape": if (sessionActive()) openMenu(); else goHome(); break;
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
      case "ArrowLeft": goHome(); break; // session (and shading) persists
      case "Enter": startExercise(dayIndex, sumSel, "summary"); break;
      case "Escape": openMenu(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }

  // mode === "workout"
  if (!engine) {
    if (exerciseDoneCard) {
      // "Done, or one more set?" - fix reps, add a set, or continue.
      if (e.key === "ArrowLeft") { amendLastReps(-1); renderExerciseDone(); }
      else if (e.key === "ArrowRight") { amendLastReps(1); renderExerciseDone(); }
      else if (e.key === "ArrowUp") { startExercise(curDayIdx, curExIdx, cameFrom); } // one more set
      else if (e.key === "Enter") { exerciseDoneCard = false; backFromExercise(); }
      else if (e.key === "Escape") openMenu();
      e.preventDefault();
      return;
    }
    if (endScreen) {
      if (e.key === "Enter") { endScreen = false; goHome(); }
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") goHome();
    e.preventDefault();
    return;
  }
  const snap = engine.snapshot();
  const st = snap.status;
  switch (e.key) {
    case "Enter":
      if (st === "exercise_preview") engine.startSet();
      else if (st === "active_set" && snap.card.kind === "active_set") {
        if (phase === "ready") { phase = "lifting"; liftElapsed = 0; touchActivity(); renderWorkout(snap); }
        else {
          const s = curStep();
          const weight = weightFor(s?.step.id ?? "", snap.card.targetWeight);
          const reps = repsFor(s?.step.id ?? "", snap.card.targetReps);
          engine.completeSet({ weight, reps, durationSeconds: liftElapsed });
        }
      }
      else if (st === "resting") engine.skipRest();
      break;
    case "Escape": // middle-finger pinch = the menu (Resume / Back / END / Discard)
      openMenu();
      break;
    case "ArrowLeft":
      if (st === "active_set") adjustWeight(-WEIGHT_STEP);
      else if (st === "resting") { amendLastReps(-1); renderWorkout(engine.snapshot()); }
      else if (st === "exercise_preview") backFromExercise();
      break;
    case "ArrowRight":
      if (st === "active_set") adjustWeight(WEIGHT_STEP);
      else if (st === "resting") { amendLastReps(1); renderWorkout(engine.snapshot()); }
      break;
    case "ArrowUp":
      if (st === "active_set") adjustReps(1);
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
 * plan for next time. Refresh the home status line if it's showing. */
async function flushAndRefresh(): Promise<void> {
  if (!token) return;
  try {
    const summary = await flushOutbox(token);
    if (summary.deadlettered > 0) {
      try {
        const r = await fetchPlan(token);
        if ("workouts" in r) applyFreshPlan(r.workouts);
      } catch { /* offline; try later */ }
    }
    if (mode === "home" && !menuOpen) renderHome();
  } catch { /* offline; the online listener retries */ }
}

/** Restore (or auto-finalize) the session left behind by a previous visit.
 * Returns true when it also chose the screen to show. */
function resumeSession(): boolean {
  const cp = loadCheckpoint();
  if (!cp) return false;
  const stale = Date.now() - (cp.savedAt ?? 0) > STALE_SESSION_MS;
  if (!cp.results.length) {
    // Nothing was lifted - just recover any pre-set dial-ins (unless old).
    if (!stale) restoreFromCheckpoint(cp);
    else clearCheckpoint();
    return false;
  }
  restoreFromCheckpoint(cp);
  if (stale) {
    // He never pressed END (battery died / forgot): the workout still counts.
    // Finalize + queue it silently; land on a fresh home screen.
    finalizeSession(false);
    return false;
  }
  // Land back in the day he was working - matched by plan ID first (web-side
  // plan changes can shift indices), by index as a fallback for old data.
  let idx = cp.lastPlanId ? WORKOUTS.findIndex((w) => w.plan.id === cp.lastPlanId) : -1;
  if (idx < 0 && cp.lastDayIndex >= 0 && cp.lastDayIndex < WORKOUTS.length) idx = cp.lastDayIndex;
  if (idx >= 0) { dayIndex = idx; openDay(idx); return true; }
  return false; // that plan is gone: home still shows the session's shading
}

/** Apply a freshly fetched plan, but never yank the ground out from under an
 * OPEN SESSION or a non-home screen - defer the swap to the next clean boot.
 * A deferred response can't flip any state the live session depends on. */
function applyFreshPlan(workouts: EngineWorkout[]): void {
  if (sessionActive() || (mode !== "home" && mode !== "blocked")) return;
  WORKOUTS = workouts;
  applySaved();
  if (WORKOUTS.length) {
    homeSel = Math.min(homeSel, WORKOUTS.length);
    if (!menuOpen) renderHome();
  }
  else renderPairScreen();
}

async function boot(): Promise<void> {
  migrateLegacyLast();
  token = getToken();
  if (!token || !isConfigured()) { renderPairScreen(); return; }

  const cached = loadCachedPlan();
  if (cached) {
    WORKOUTS = cached;
    applySaved();
    if (!resumeSession()) {
      homeSel = firstUndoneDay();
      renderHome();
    }
  } else {
    renderConnecting();
  }

  try {
    const result = await fetchPlan(token);
    if ("workouts" in result) {
      if (!cached) {
        // First load: apply, then resume any session (e.g. plan cache was
        // cleared but the checkpoint survived).
        WORKOUTS = result.workouts;
        applySaved();
        if (WORKOUTS.length) { if (!resumeSession()) { homeSel = firstUndoneDay(); renderHome(); } }
        else renderPairScreen();
      } else {
        applyFreshPlan(result.workouts);
      }
    } else if (result.error === "invalid_token") {
      // Token was revoked (or is bad): lock the device out even if a plan was
      // cached, and drop the stale token + plan so it can't keep showing data.
      clearTokenAndPlan();
      token = null;
      WORKOUTS = [];
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
