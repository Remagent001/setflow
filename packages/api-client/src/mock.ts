// In-memory ApiClient - powers dev/preview/tests with zero backend.
// Pre-seeded with a small exercise library and one sample workout so the
// player has something to run immediately. Pass a storage adapter to make
// the store survive reloads (web uses localStorage; mobile will use
// AsyncStorage in Segment 17).

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

export type MockStore = {
  counter: number;
  exercises: Exercise[];
  media: ExerciseMedia[];
  plans: WorkoutPlan[];
  steps: WorkoutStep[];
  sessions: WorkoutSession[];
  setLogs: SetLog[];
  journals: WorkoutJournal[];
};

export type MockStorage = {
  load(): MockStore | null;
  save(store: MockStore): void;
};

const now = () => new Date().toISOString();

function seedStore(): MockStore {
  const store: MockStore = {
    counter: 0,
    exercises: [],
    media: [],
    plans: [],
    steps: [],
    sessions: [],
    setLogs: [],
    journals: [],
  };
  const id = () => `mock-${++store.counter}`;

  const seedExercise = (
    name: string,
    muscle: string,
    cues: string[],
    mistakes: string[]
  ): Exercise => {
    const e: Exercise = {
      id: id(),
      name,
      primaryMuscleGroup: muscle,
      cues,
      commonMistakes: mistakes,
      createdAt: now(),
      updatedAt: now(),
    };
    store.exercises.push(e);
    return e;
  };
  const bench = seedExercise(
    "Incline Dumbbell Press",
    "Chest",
    ["Elbows 45 degrees", "Press up and slightly back"],
    ["Setting the incline too steep"]
  );
  const row = seedExercise(
    "Bent-Over Barbell Row",
    "Back",
    ["Flat back", "Pull to the lower ribs"],
    ["Using momentum"]
  );
  const press = seedExercise(
    "Overhead Press",
    "Shoulders",
    ["Squeeze glutes", "Bar path close to the face"],
    ["Arching the lower back"]
  );

  const samplePlan: WorkoutPlan = {
    id: id(),
    ownerUserId: "mock-user",
    title: "Upper Body A",
    estimatedDurationMinutes: 52,
    createdAt: now(),
    updatedAt: now(),
  };
  store.plans.push(samplePlan);
  [bench, row, press].forEach((e, i) => {
    store.steps.push({
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
  return store;
}

export function createMockApiClient(options?: { storage?: MockStorage }): ApiClient {
  const storage = options?.storage;
  const store: MockStore = storage?.load() ?? seedStore();

  const id = () => `mock-${++store.counter}`;
  const persist = () => storage?.save(store);
  persist(); // write the seed on first run so reloads see it

  const mustFind = <T extends { id: string }>(arr: T[], itemId: string, label: string): T => {
    const item = arr.find((x) => x.id === itemId);
    if (!item) throw new Error(`${label} not found: ${itemId}`);
    return item;
  };

  return {
    // --- exercises ---------------------------------------------------------
    async listExercises() {
      return [...store.exercises];
    },
    async getExercise(exerciseId) {
      return store.exercises.find((e) => e.id === exerciseId) ?? null;
    },
    async createExercise(input: NewExercise) {
      const e: Exercise = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      store.exercises.push(e);
      persist();
      return e;
    },
    async updateExercise(exerciseId, patch) {
      const e = mustFind(store.exercises, exerciseId, "exercise");
      Object.assign(e, patch, { updatedAt: now() });
      persist();
      return e;
    },
    async deleteExercise(exerciseId) {
      const i = store.exercises.findIndex((e) => e.id === exerciseId);
      if (i >= 0) store.exercises.splice(i, 1);
      persist();
    },
    async addExerciseMedia(input: NewExerciseMedia) {
      const m: ExerciseMedia = { ...input, id: id(), createdAt: now() };
      store.media.push(m);
      persist();
      return m;
    },
    async listExerciseMedia(exerciseId) {
      return store.media.filter((m) => m.exerciseId === exerciseId);
    },
    async deleteExerciseMedia(mediaId) {
      const i = store.media.findIndex((m) => m.id === mediaId);
      if (i >= 0) store.media.splice(i, 1);
      persist();
    },

    // --- plans ---------------------------------------------------------------
    async listWorkoutPlans() {
      return [...store.plans];
    },
    async getWorkoutPlan(planId): Promise<WorkoutPlanWithSteps | null> {
      const plan = store.plans.find((p) => p.id === planId);
      if (!plan) return null;
      const planSteps = store.steps
        .filter((s) => s.workoutPlanId === planId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      return { ...plan, steps: planSteps };
    },
    async createWorkoutPlan(input: NewWorkoutPlan) {
      const p: WorkoutPlan = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      store.plans.push(p);
      persist();
      return p;
    },
    async updateWorkoutPlan(planId, patch) {
      const p = mustFind(store.plans, planId, "workout plan");
      Object.assign(p, patch, { updatedAt: now() });
      persist();
      return p;
    },
    async deleteWorkoutPlan(planId) {
      const i = store.plans.findIndex((p) => p.id === planId);
      if (i >= 0) store.plans.splice(i, 1);
      persist();
    },
    async addWorkoutStep(input: NewWorkoutStep) {
      const s: WorkoutStep = { ...input, id: id() };
      store.steps.push(s);
      persist();
      return s;
    },
    async updateWorkoutStep(stepId, patch) {
      const s = mustFind(store.steps, stepId, "workout step");
      Object.assign(s, patch);
      persist();
      return s;
    },
    async deleteWorkoutStep(stepId) {
      const i = store.steps.findIndex((s) => s.id === stepId);
      if (i >= 0) store.steps.splice(i, 1);
      persist();
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
      store.sessions.push(s);
      persist();
      return s;
    },
    async getSession(sessionId) {
      return store.sessions.find((s) => s.id === sessionId) ?? null;
    },
    async completeSession(sessionId, durationSeconds) {
      const s = mustFind(store.sessions, sessionId, "session");
      Object.assign(s, {
        status: "completed",
        completedAt: now(),
        durationSeconds,
        updatedAt: now(),
      });
      persist();
      return s;
    },
    async abandonSession(sessionId) {
      const s = mustFind(store.sessions, sessionId, "session");
      Object.assign(s, { status: "abandoned", updatedAt: now() });
      persist();
      return s;
    },

    // --- set logs --------------------------------------------------------------
    async createSetLog(input: NewSetLog) {
      const l: SetLog = { ...input, id: id(), createdAt: now() };
      store.setLogs.push(l);
      persist();
      return l;
    },
    async updateSetLog(logId, patch) {
      const l = mustFind(store.setLogs, logId, "set log");
      Object.assign(l, patch);
      persist();
      return l;
    },
    async listSetLogs(sessionId) {
      return store.setLogs.filter((l) => l.sessionId === sessionId);
    },

    // --- journal ---------------------------------------------------------------
    async getJournal(sessionId) {
      return store.journals.find((j) => j.sessionId === sessionId) ?? null;
    },
    async saveJournal(input: NewWorkoutJournal) {
      const existing = store.journals.find((j) => j.sessionId === input.sessionId);
      if (existing) {
        Object.assign(existing, input, { updatedAt: now() });
        persist();
        return existing;
      }
      const j: WorkoutJournal = { ...input, id: id(), createdAt: now(), updatedAt: now() };
      store.journals.push(j);
      persist();
      return j;
    },

    // --- reports (stub until Segment 16) -----------------------------------------
    async getDashboardSummary(): Promise<DashboardSummary> {
      const completed = store.sessions.filter((s) => s.status === "completed");
      return {
        workoutsThisWeek: completed.length,
        totalSets: store.setLogs.length,
        totalVolume: store.setLogs.reduce(
          (sum, l) => sum + (l.actualWeight ?? 0) * (l.actualReps ?? 0),
          0
        ),
        averageDurationMinutes: 0,
        currentStreakDays: 0,
      };
    },
  };
}
