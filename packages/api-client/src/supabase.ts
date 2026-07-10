// Supabase-backed ApiClient. All table access goes through the generic
// helpers so casing and error handling live in exactly one place.
// When a user is signed in, ownership fields (userId/ownerUserId) are always
// taken from the auth session - callers can keep passing their local ids and
// the right owner is stamped on anyway (RLS requires it).

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

/** Pass a pre-built client (e.g. with AsyncStorage auth persistence) or url+key. */
export function createSupabaseApiClient(
  config: SupabaseApiConfig | { client: SupabaseClient }
): ApiClient {
  const sb: SupabaseClient =
    "client" in config ? config.client : createClient(config.url, config.apiKey);

  const fail = (op: string, message: string): never => {
    throw new Error(`[api-client] ${op} failed: ${message}`);
  };

  /** The signed-in user's id; falls back to the caller-provided id (dev/mock). */
  async function uid(fallback?: string): Promise<string> {
    const { data } = await sb.auth.getSession();
    return data.session?.user.id ?? fallback ?? "anonymous";
  }

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
    createExercise: async (input) =>
      insertOne<Exercise>("exercises", { ...input, ownerUserId: await uid(input.ownerUserId) }),
    updateExercise: (id, patch) => updateOne<Exercise>("exercises", id, patch),
    deleteExercise: (id) => deleteOne("exercises", id),
    addExerciseMedia: async (input) =>
      insertOne<ExerciseMedia>("exercise_media", {
        ...input,
        // Media ownership is per-row (users attach photos to GLOBAL exercises
        // too); RLS requires the stamp to match the session user.
        ownerUserId: await uid(input.ownerUserId),
      }),
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
    createWorkoutPlan: async (input) =>
      insertOne<WorkoutPlan>("workout_plans", {
        ...input,
        ownerUserId: await uid(input.ownerUserId),
      }),
    updateWorkoutPlan: (id, patch) => updateOne<WorkoutPlan>("workout_plans", id, patch),
    deleteWorkoutPlan: (id) => deleteOne("workout_plans", id),
    addWorkoutStep: (input) => insertOne<WorkoutStep>("workout_steps", input),
    updateWorkoutStep: (id, patch) => updateOne<WorkoutStep>("workout_steps", id, patch),
    deleteWorkoutStep: (id) => deleteOne("workout_steps", id),

    // --- sessions ------------------------------------------------------------
    startSession: async (userId, workoutPlanId) =>
      insertOne<WorkoutSession>("workout_sessions", {
        userId: await uid(userId),
        workoutPlanId,
        status: "in_progress",
        startedAt: new Date().toISOString(),
      }),
    getSession: (id) => selectOne<WorkoutSession>("workout_sessions", id),
    listSessions: async (userId) => {
      const rows = await selectAll<WorkoutSession>("workout_sessions", {
        user_id: await uid(userId),
      });
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
      const stamped = { ...input, userId: await uid(input.userId) };
      const existing = await this.getJournal(input.sessionId);
      if (existing) return updateOne<WorkoutJournal>("workout_journals", existing.id, stamped);
      return insertOne<WorkoutJournal>("workout_journals", stamped);
    },

    // --- reports -----------------------------------------------------------------
    async getDashboardSummary(userId): Promise<DashboardSummary> {
      const me = await uid(userId);
      const sessions = await selectAll<WorkoutSession>("workout_sessions", { user_id: me });
      const completed = sessions.filter((s) => s.status === "completed");
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const thisWeek = completed.filter((s) => new Date(s.createdAt).getTime() >= weekAgo);

      let weekLogs: SetLog[] = [];
      const ids = thisWeek.map((s) => s.id);
      if (ids.length > 0) {
        const { data, error } = await sb.from("set_logs").select("*").in("session_id", ids);
        if (error) fail("select set_logs", error.message);
        weekLogs = (data ?? []).map((r) => rowToApp<SetLog>(r)).filter((l) => l.status !== "skipped");
      }

      const durations = thisWeek
        .map((s) => s.durationSeconds)
        .filter((d): d is number => d != null);

      const days = new Set(completed.map((s) => new Date(s.createdAt).toDateString()));
      let streak = 0;
      const cursor = new Date();
      if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
      while (days.has(cursor.toDateString())) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      return {
        workoutsThisWeek: thisWeek.length,
        totalSets: weekLogs.length,
        totalVolume: weekLogs.reduce(
          (sum, l) => sum + (l.actualWeight ?? 0) * (l.actualReps ?? 0),
          0
        ),
        averageDurationMinutes: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60)
          : 0,
        currentStreakDays: streak,
      };
    },
  };
}
