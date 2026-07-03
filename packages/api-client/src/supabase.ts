// Supabase-backed ApiClient. All table access goes through the generic
// helpers so casing and error handling live in exactly one place.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Exercise,
  ExerciseMedia,
  SetLog,
  WorkoutJournal,
  WorkoutPlan,
  WorkoutSession,
  WorkoutStep,
} from "@setflow/shared";
import { appToRow, rowToApp } from "./casing";
import type { ApiClient, DashboardSummary, WorkoutPlanWithSteps } from "./types";

export type SupabaseApiConfig = {
  url: string;
  /** anon key for user-scoped apps; service key only in trusted server code */
  apiKey: string;
};

export function createSupabaseApiClient(config: SupabaseApiConfig): ApiClient {
  const sb: SupabaseClient = createClient(config.url, config.apiKey);

  const fail = (op: string, message: string): never => {
    throw new Error(`[api-client] ${op} failed: ${message}`);
  };

  async function selectAll<T>(table: string, filter?: Record<string, unknown>): Promise<T[]> {
    let q = sb.from(table).select("*");
    for (const [k, v] of Object.entries(filter ?? {})) q = q.eq(k, v as string);
    const { data, error } = await q;
    if (error) fail(`select ${table}`, error.message);
    return (data ?? []).map((r) => rowToApp<T>(r));
  }

  async function selectOne<T>(table: string, id: string): Promise<T | null> {
    const { data, error } = await sb.from(table).select("*").eq("id", id).maybeSingle();
    if (error) fail(`get ${table}`, error.message);
    return data ? rowToApp<T>(data) : null;
  }

  async function insertOne<T>(table: string, values: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.from(table).insert(appToRow(values)).select().single();
    if (error || !data) fail(`insert ${table}`, error?.message ?? "no row returned");
    return rowToApp<T>(data!);
  }

  async function updateOne<T>(
    table: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<T> {
    const { data, error } = await sb
      .from(table)
      .update(appToRow(patch))
      .eq("id", id)
      .select()
      .single();
    if (error || !data) fail(`update ${table}`, error?.message ?? "no row returned");
    return rowToApp<T>(data!);
  }

  async function deleteOne(table: string, id: string): Promise<void> {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) fail(`delete ${table}`, error.message);
  }

  return {
    // --- exercises ---------------------------------------------------------
    listExercises: () => selectAll<Exercise>("exercises"),
    getExercise: (id) => selectOne<Exercise>("exercises", id),
    createExercise: (input) => insertOne<Exercise>("exercises", input),
    updateExercise: (id, patch) => updateOne<Exercise>("exercises", id, patch),
    deleteExercise: (id) => deleteOne("exercises", id),
    addExerciseMedia: (input) => insertOne<ExerciseMedia>("exercise_media", input),
    listExerciseMedia: (exerciseId) =>
      selectAll<ExerciseMedia>("exercise_media", { exercise_id: exerciseId }),
    deleteExerciseMedia: (id) => deleteOne("exercise_media", id),

    // --- plans ---------------------------------------------------------------
    listWorkoutPlans: () => selectAll<WorkoutPlan>("workout_plans"),
    async getWorkoutPlan(id): Promise<WorkoutPlanWithSteps | null> {
      const plan = await selectOne<WorkoutPlan>("workout_plans", id);
      if (!plan) return null;
      const steps = await selectAll<WorkoutStep>("workout_steps", { workout_plan_id: id });
      steps.sort((a, b) => a.orderIndex - b.orderIndex);
      return { ...plan, steps };
    },
    createWorkoutPlan: (input) => insertOne<WorkoutPlan>("workout_plans", input),
    updateWorkoutPlan: (id, patch) => updateOne<WorkoutPlan>("workout_plans", id, patch),
    deleteWorkoutPlan: (id) => deleteOne("workout_plans", id),
    addWorkoutStep: (input) => insertOne<WorkoutStep>("workout_steps", input),
    updateWorkoutStep: (id, patch) => updateOne<WorkoutStep>("workout_steps", id, patch),
    deleteWorkoutStep: (id) => deleteOne("workout_steps", id),

    // --- sessions ------------------------------------------------------------
    startSession: (userId, workoutPlanId) =>
      insertOne<WorkoutSession>("workout_sessions", {
        userId,
        workoutPlanId,
        status: "in_progress",
        startedAt: new Date().toISOString(),
      }),
    getSession: (id) => selectOne<WorkoutSession>("workout_sessions", id),
    listSessions: async (userId) => {
      const rows = await selectAll<WorkoutSession>("workout_sessions", { user_id: userId });
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    completeSession: (id, durationSeconds) =>
      updateOne<WorkoutSession>("workout_sessions", id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        durationSeconds,
      }),
    abandonSession: (id) =>
      updateOne<WorkoutSession>("workout_sessions", id, { status: "abandoned" }),

    // --- set logs --------------------------------------------------------------
    createSetLog: (input) => insertOne<SetLog>("set_logs", input),
    updateSetLog: (id, patch) => updateOne<SetLog>("set_logs", id, patch),
    listSetLogs: (sessionId) => selectAll<SetLog>("set_logs", { session_id: sessionId }),

    // --- journal ---------------------------------------------------------------
    async getJournal(sessionId) {
      const rows = await selectAll<WorkoutJournal>("workout_journals", {
        session_id: sessionId,
      });
      return rows[0] ?? null;
    },
    async saveJournal(input) {
      const existing = await this.getJournal(input.sessionId);
      if (existing) return updateOne<WorkoutJournal>("workout_journals", existing.id, input);
      return insertOne<WorkoutJournal>("workout_journals", input);
    },

    // --- reports (stub until Segment 16) -----------------------------------------
    async getDashboardSummary(): Promise<DashboardSummary> {
      return {
        workoutsThisWeek: 0,
        totalSets: 0,
        totalVolume: 0,
        averageDurationMinutes: 0,
        currentStreakDays: 0,
      };
    },
  };
}
