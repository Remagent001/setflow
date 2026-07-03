// Module-level active-session store: the running WorkoutEngine lives here,
// not inside a screen, so navigating away (or re-opening the player) never
// loses workout progress. The 1s rest-timer tick also lives here so rest
// keeps counting while the player is minimized.

import {
  createWorkoutEngine,
  type EngineWorkout,
  type WorkoutEngine,
} from "@setflow/workout-engine";

export type ActiveSession = {
  planId: string;
  planTitle: string;
  engine: WorkoutEngine;
  startedAtMs: number;
  /** Set once the finished session has been written through the api client. */
  saved: boolean;
};

let current: ActiveSession | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

export function startSession(planId: string, workout: EngineWorkout): ActiveSession {
  endSession();
  const engine = createWorkoutEngine(workout);
  engine.start();
  ticker = setInterval(() => engine.tick(), 1000);
  current = {
    planId,
    planTitle: workout.plan.title,
    engine,
    startedAtMs: Date.now(),
    saved: false,
  };
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
  ticker = null;
  current = null;
}
