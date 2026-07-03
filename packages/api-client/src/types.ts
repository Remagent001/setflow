// The API contract both apps program against (build doc section 11).
// Two implementations: mock (in-memory, no backend needed) and supabase.

import type {
  Exercise,
  ExerciseMedia,
  SetLog,
  WorkoutJournal,
  WorkoutPlan,
  WorkoutSession,
  WorkoutStep,
} from "@setflow/shared";

export type NewExercise = Omit<Exercise, "id" | "createdAt" | "updatedAt">;
export type NewExerciseMedia = Omit<ExerciseMedia, "id" | "createdAt">;
export type NewWorkoutPlan = Omit<WorkoutPlan, "id" | "createdAt" | "updatedAt">;
export type NewWorkoutStep = Omit<WorkoutStep, "id">;
export type NewSetLog = Omit<SetLog, "id" | "createdAt">;
export type NewWorkoutJournal = Omit<WorkoutJournal, "id" | "createdAt" | "updatedAt">;

/** A workout plan with its ordered steps - what the player consumes. */
export type WorkoutPlanWithSteps = WorkoutPlan & { steps: WorkoutStep[] };

export interface ApiClient {
  // --- Exercises -----------------------------------------------------------
  listExercises(): Promise<Exercise[]>;
  getExercise(id: string): Promise<Exercise | null>;
  createExercise(input: NewExercise): Promise<Exercise>;
  updateExercise(id: string, patch: Partial<NewExercise>): Promise<Exercise>;
  deleteExercise(id: string): Promise<void>;
  addExerciseMedia(input: NewExerciseMedia): Promise<ExerciseMedia>;
  listExerciseMedia(exerciseId: string): Promise<ExerciseMedia[]>;

  // --- Workout plans -------------------------------------------------------
  listWorkoutPlans(): Promise<WorkoutPlan[]>;
  getWorkoutPlan(id: string): Promise<WorkoutPlanWithSteps | null>;
  createWorkoutPlan(input: NewWorkoutPlan): Promise<WorkoutPlan>;
  updateWorkoutPlan(id: string, patch: Partial<NewWorkoutPlan>): Promise<WorkoutPlan>;
  deleteWorkoutPlan(id: string): Promise<void>;
  addWorkoutStep(input: NewWorkoutStep): Promise<WorkoutStep>;
  updateWorkoutStep(id: string, patch: Partial<NewWorkoutStep>): Promise<WorkoutStep>;
  deleteWorkoutStep(id: string): Promise<void>;

  // --- Sessions ------------------------------------------------------------
  startSession(userId: string, workoutPlanId: string): Promise<WorkoutSession>;
  getSession(id: string): Promise<WorkoutSession | null>;
  completeSession(id: string, durationSeconds: number): Promise<WorkoutSession>;
  abandonSession(id: string): Promise<WorkoutSession>;

  // --- Set logs ------------------------------------------------------------
  createSetLog(input: NewSetLog): Promise<SetLog>;
  updateSetLog(id: string, patch: Partial<NewSetLog>): Promise<SetLog>;
  listSetLogs(sessionId: string): Promise<SetLog[]>;

  // --- Journal -------------------------------------------------------------
  getJournal(sessionId: string): Promise<WorkoutJournal | null>;
  saveJournal(input: NewWorkoutJournal): Promise<WorkoutJournal>;

  // --- Reports (stubs until Segment 16) -------------------------------------
  getDashboardSummary(userId: string): Promise<DashboardSummary>;
}

export type DashboardSummary = {
  workoutsThisWeek: number;
  totalSets: number;
  totalVolume: number;
  averageDurationMinutes: number;
  currentStreakDays: number;
};
