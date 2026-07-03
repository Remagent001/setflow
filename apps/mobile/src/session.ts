// Module-level active-session store: the running WorkoutEngine lives here,
// not inside a screen, so navigating away (or re-opening the player) never
// loses workout progress. The 1s rest-timer tick also lives here so rest
// keeps counting while the player is minimized.
//
// Persistence (Segment 14) is incremental and owned by this store: a
// WorkoutSession row is created when the workout starts, every set log is
// saved the moment the engine records it, and completion (plus rolling the
// lifted weights forward as the plan's new defaults) happens as soon as the
// engine reaches workout_complete - even if the player screen is closed.

import type { NewWorkoutJournal } from "@setflow/api-client";
import {
  createWorkoutEngine,
  type EngineWorkout,
  type WorkoutEngine,
} from "@setflow/workout-engine";
import { getApi, MOCK_USER_ID } from "./api";
import { getSettings } from "./settings";

/** Journal fields minus the keys the store fills in itself. */
export type JournalPatch = Partial<Omit<NewWorkoutJournal, "sessionId" | "userId">>;

export type ActiveSession = {
  planId: string;
  planTitle: string;
  engine: WorkoutEngine;
  startedAtMs: number;
  /** Upsert pre/post-workout journal fields onto this session (Segment 15). */
  journal: (patch: JournalPatch) => void;
};

let current: ActiveSession | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

export function startSession(planId: string, workout: EngineWorkout): ActiveSession {
  endSession();
  const engine = createWorkoutEngine(workout, { unit: getSettings().weightUnit });
  const startedAtMs = Date.now();

  // Sequential write queue so saves never race each other.
  const api = getApi();
  let queue: Promise<unknown> = api
    .startSession(MOCK_USER_ID, planId)
    .then((s) => s.id)
    .catch(() => null);
  const enqueue = (work: (dbSessionId: string | null) => Promise<unknown>) => {
    queue = queue.then(async (dbSessionId) => {
      try {
        await work(dbSessionId as string | null);
      } catch {
        // Mock mode: writes are best-effort; Segment 17 adds real offline sync.
      }
      return dbSessionId;
    });
  };

  const journal = (patch: JournalPatch) => {
    enqueue(async (dbSessionId) => {
      if (!dbSessionId) return;
      // saveJournal upserts by sessionId, so partial patches accumulate.
      await api.saveJournal({ sessionId: dbSessionId, userId: MOCK_USER_ID, ...patch });
    });
  };

  current = { planId, planTitle: workout.plan.title, engine, startedAtMs, journal };

  let savedCount = 0;
  let completed = false;
  unsubscribe = engine.subscribe((snap) => {
    // Save any newly recorded sets.
    while (savedCount < snap.results.length) {
      const r = snap.results[savedCount];
      savedCount++;
      if (!r) continue;
      enqueue((dbSessionId) => {
        if (!dbSessionId) return Promise.resolve();
        return api.createSetLog({
          sessionId: dbSessionId,
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
          difficulty: r.difficulty,
          note: r.note,
          loggedBy: r.loggedBy,
          // Privacy (Segment 20): transcripts are kept only when opted in.
          transcript: getSettings().storeTranscripts ? r.transcript : undefined,
          confidence: r.confidence,
        });
      });
    }

    if (snap.status === "workout_complete" && !completed) {
      completed = true;
      const durationSeconds = Math.round((Date.now() - startedAtMs) / 1000);

      // "Next time, default to what I actually lifted."
      const lastWeightByStep = new Map<string, number>();
      for (const r of snap.results) {
        if (r.status !== "skipped" && r.actualWeight != null) {
          lastWeightByStep.set(r.workoutStepId, r.actualWeight);
        }
      }
      enqueue(async (dbSessionId) => {
        if (dbSessionId) await api.completeSession(dbSessionId, durationSeconds);
        for (const [stepId, weight] of lastWeightByStep) {
          const step = workout.steps.find((s) => s.step.id === stepId);
          if (step && step.step.targetWeight !== weight) {
            await api.updateWorkoutStep(stepId, { targetWeight: weight });
          }
        }
      });
    }
  });

  engine.start();
  ticker = setInterval(() => engine.tick(), 1000);
  return current;
}

/** The in-flight session, optionally only if it belongs to the given plan. */
export function getSession(planId?: string): ActiveSession | null {
  if (!current) return null;
  if (planId && current.planId !== planId) return null;
  return current;
}

export function endSession(): void {
  if (ticker) clearInterval(ticker);
  if (unsubscribe) unsubscribe();
  ticker = null;
  unsubscribe = null;
  current = null;
}
