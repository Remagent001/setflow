// First-login seeding: a brand-new account gets a ready-to-run "Upper Body A"
// workout, so the full app flow works immediately. Exercises come from the
// shared library when it's visible (the database ships one); anything
// missing is created for the user. No-op once the user has any workout plan.

import type { Exercise } from "@setflow/shared";
import type { ApiClient, NewExercise } from "./types";

const STARTERS: Array<NewExercise & { targetWeight: number }> = [
  {
    name: "Incline Dumbbell Press",
    primaryMuscleGroup: "Chest",
    cues: ["Elbows 45 degrees", "Press up and slightly back"],
    commonMistakes: ["Setting the incline too steep"],
    targetWeight: 75,
  },
  {
    name: "Bent-Over Barbell Row",
    primaryMuscleGroup: "Back",
    cues: ["Flat back", "Pull to the lower ribs"],
    commonMistakes: ["Using momentum"],
    targetWeight: 75,
  },
  {
    name: "Overhead Press",
    primaryMuscleGroup: "Shoulders",
    cues: ["Squeeze glutes", "Bar path close to the face"],
    commonMistakes: ["Arching the lower back"],
    targetWeight: 75,
  },
];

export async function ensureStarterData(api: ApiClient, userId: string): Promise<boolean> {
  const [exercises, plans] = await Promise.all([api.listExercises(), api.listWorkoutPlans()]);
  if (plans.length > 0) return false;

  const byName = new Map(exercises.map((e) => [e.name.toLowerCase(), e]));
  const resolved: Array<{ exercise: Exercise; targetWeight: number }> = [];
  for (const def of STARTERS) {
    const { targetWeight, ...input } = def;
    const existing = byName.get(def.name.toLowerCase());
    resolved.push({
      exercise: existing ?? (await api.createExercise({ ...input, ownerUserId: userId })),
      targetWeight,
    });
  }

  const plan = await api.createWorkoutPlan({
    ownerUserId: userId,
    title: "Upper Body A",
    estimatedDurationMinutes: 52,
  });
  for (let i = 0; i < resolved.length; i++) {
    await api.addWorkoutStep({
      workoutPlanId: plan.id,
      exerciseId: resolved[i]!.exercise.id,
      orderIndex: i,
      setCount: 3,
      targetReps: 10,
      targetWeight: resolved[i]!.targetWeight,
      restSeconds: 90,
    });
  }
  return true;
}
