// @setflow/api-client - typed data layer for web and mobile.
// Mock mode = in-memory, zero backend. Supabase mode = the real database.

export type { ApiClient, DashboardSummary, WorkoutPlanWithSteps } from "./types";
export type {
  NewExercise,
  NewExerciseMedia,
  NewSetLog,
  NewWorkoutJournal,
  NewWorkoutPlan,
  NewWorkoutStep,
} from "./types";
export { createMockApiClient, type MockStore, type MockStorage } from "./mock";
export { createSupabaseApiClient, type SupabaseApiConfig } from "./supabase";

export const PACKAGE_NAME = "@setflow/api-client";
