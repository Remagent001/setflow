// In-memory ApiClient - powers dev/preview/tests with zero backend.
// Pre-seeded with a small exercise library and one sample workout so the
// player has something to run immediately.

import type {
  Exercise,
  ExerciseMedia,
  SetLog,
  WorkoutJournal,
  WorkoutPlan,
  WorkoutSession,
  WorkoutStep,
} from "@setflow/shared";
import type {
  ApiClient,
  DashboardSummary,
  NewExercise,
  NewExerciseMedia,
  NewSetLog,
  NewWorkoutJournal,
  NewWorkoutPlan,
  NewWorkoutStep,
  WorkoutPlanWithSteps,
} from "./types";

let counter = 0;
const id = () => `mock-${++counter}`;
const now = () => new Date().toISOString();

export function createMockApiClient(): ApiClient {
  const exercises: Exercise[] = [];
  const media: ExerciseMedia[] = [];
  const plans: WorkoutPlan[] = [];
  const steps: WorkoutStep[] = [];
  const sessions: WorkoutSession[] = [];
  const setLogs: SetLog[] = [];
  const journals: WorkoutJournal[] = [];

  // --- seed ---------------------------------------------------------------
  const seedExercise = (name: string, muscle: string): Exercise => {
    const e: Exercise = {
      id: id(),
      name,
      primaryMuscleGroup: muscle,
      createdAt: now(),
      updatedAt: now(),
    };
    exercises.push(e);
    return e;
  };
  const bench = seedExercise("Incline Dumbbell Press", "Chest");
  const row = seedExercise("Bent-Over Barbell Row", "Back");
  const press = seedExercise("Overhead Press", "Shoulders");

  const samplePlan: WorkoutPlan = {
    id: id(),
    ownerUserId: "mock-user",
    title: "Upper Body A",
    estimatedDurationMinutes: 52,
    createdAt: now(),
    updatedAt: now(),
  };
  plans.push(samplePlan);
  [bench, row, press].forEach((e, i) => {
    steps.push({
      id: id(),
      workoutPlanId: samplePlan.id,
      exerciseId: e.id,
      orderIndex: i,
      setCount: 3,
      targetReps: 10,
      targetWeight: 75,
      restSeconds: 90,
    });
  });

  const mustFind = <T extends { id: string }>(arr: T[], itemId: string, label: string): T => {
    const item = arr.find((x) => x.id === itemId);
    if (!item) throw new Error(`${label} not found: ${itemId}`);
    return item;
  };

  return {
    // --- exercises ---------------------------------------------------------
    async listExercises() {
      return [...exercises];
    },
    async getExercise(exerciseId) {
      return exercises.find((e) => e.id === exerciseId) ?? null;
    },
    async createExercise(input: NewExercise) {
      const e: Exercise = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      exercises.push(e);
      return e;
    },
    async updateExercise(exerciseId, patch) {
      const e = mustFind(exercises, exerciseId, "exercise");
      Object.assign(e, patch, { updatedAt: now() });
      return e;
    },
    async deleteExercise(exerciseId) {
      const i = exercises.findIndex((e) => e.id === exerciseId);
      if (i >= 0) exercises.splice(i, 1);
    },
    async addExerciseMedia(input: NewExerciseMedia) {
      const m: ExerciseMedia = { ...input, id: id(), createdAt: now() };
      media.push(m);
      return m;
    },
    async listExerciseMedia(exerciseId) {
      return media.filter((m) => m.exerciseId === exerciseId);
    },

    // --- plans ---------------------------------------------------------------
    async listWorkoutPlans() {
      return [...plans];
    },
    async getWorkoutPlan(planId): Promise<WorkoutPlanWithSteps | null> {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return null;
      const planSteps = steps
        .filter((s) => s.workoutPlanId === planId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      return { ...plan, steps: planSteps };
    },
    async createWorkoutPlan(input: NewWorkoutPlan) {
      const p: WorkoutPlan = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      plans.push(p);
      return p;
    },
    async updateWorkoutPlan(planId, patch) {
      const p = mustFind(plans, planId, "workout plan");
      Object.assign(p, patch, { updatedAt: now() });
      return p;
    },
    async deleteWorkoutPlan(planId) {
      const i = plans.findIndex((p) => p.id === planId);
      if (i >= 0) plans.splice(i, 1);
    },
    async addWorkoutStep(input: NewWorkoutStep) {
      const s: WorkoutStep = { ...input, id: id() };
      steps.push(s);
      return s;
    },
    async updateWorkoutStep(stepId, patch) {
      const s = mustFind(steps, stepId, "workout step");
      Object.assign(s, patch);
      return s;
    },
    async deleteWorkoutStep(stepId) {
      const i = steps.findIndex((s) => s.id === stepId);
      if (i >= 0) steps.splice(i, 1);
    },

    // --- sessions ------------------------------------------------------------
    async startSession(userId, workoutPlanId) {
      const s: WorkoutSession = {
        id: id(),
        userId,
        workoutPlanId,
        status: "in_progress",
        startedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      };
      sessions.push(s);
      return s;
    },
    async getSession(sessionId) {
      return sessions.find((s) => s.id === sessionId) ?? null;
    },
    async completeSession(sessionId, durationSeconds) {
      const s = mustFind(sessions, sessionId, "session");
      Object.assign(s, {
        status: "completed",
        completedAt: now(),
        durationSeconds,
        updatedAt: now(),
      });
      return s;
    },
    async abandonSession(sessionId) {
      const s = mustFind(sessions, sessionId, "session");
      Object.assign(s, { status: "abandoned", updatedAt: now() });
      return s;
    },

    // --- set logs --------------------------------------------------------------
    async createSetLog(input: NewSetLog) {
      const l: SetLog = { ...input, id: id(), createdAt: now() };
      setLogs.push(l);
      return l;
    },
    async updateSetLog(logId, patch) {
      const l = mustFind(setLogs, logId, "set log");
      Object.assign(l, patch);
      return l;
    },
    async listSetLogs(sessionId) {
      return setLogs.filter((l) => l.sessionId === sessionId);
    },

    // --- journal ---------------------------------------------------------------
    async getJournal(sessionId) {
      return journals.find((j) => j.sessionId === sessionId) ?? null;
    },
    async saveJournal(input: NewWorkoutJournal) {
      const existing = journals.find((j) => j.sessionId === input.sessionId);
      if (existing) {
        Object.assign(existing, input, { updatedAt: now() });
        return existing;
      }
      const j: WorkoutJournal = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      journals.push(j);
      return j;
    },

    // --- reports (stub until Segment 16) -----------------------------------------
    async getDashboardSummary(): Promise<DashboardSummary> {
      const completed = sessions.filter((s) => s.status === "completed");
      return {
        workoutsThisWeek: completed.length,
        totalSets: setLogs.length,
        totalVolume: setLogs.reduce(
          (sum, l) => sum + (l.actualWeight ?? 0) * (l.actualReps ?? 0),
          0
        ),
        averageDurationMinutes: 0,
        currentStreakDays: 0,
      };
    },
  };
}
