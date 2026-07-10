// Core domain models, per the SetFlow build document section 10.
// These are the single source of truth for entity shapes across web, mobile,
// the workout engine, and the glasses adapter.

export type WeightUnit = "lb" | "kg";
export type LogUnit = "lb" | "kg" | "bodyweight";

export type User = {
  id: string;
  email: string;
  displayName?: string;
  defaultWeightUnit: WeightUnit;
  createdAt: string;
  updatedAt: string;
};

export type Exercise = {
  id: string;
  /** Absent for built-in/library exercises; set for user-created ones. */
  ownerUserId?: string;
  name: string;
  description?: string;
  primaryMuscleGroup?: string;
  secondaryMuscleGroups?: string[];
  equipment?: string[];
  instructions?: string;
  commonMistakes?: string[];
  cues?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ExerciseMedia = {
  id: string;
  exerciseId: string;
  /** Who uploaded it (absent = built-in library media). Users can attach media
   * to GLOBAL exercises too, so ownership lives on the media row itself. */
  ownerUserId?: string;
  mediaType: "video" | "image";
  url: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  angle?: "front" | "side" | "other";
  createdAt: string;
};

export type WorkoutPlan = {
  id: string;
  ownerUserId: string;
  title: string;
  description?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimatedDurationMinutes?: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutStep = {
  id: string;
  workoutPlanId: string;
  exerciseId: string;
  orderIndex: number;
  /**
   * Adjacent steps sharing a group label run as a superset/circuit:
   * A1 -> B1 -> rest -> A2 -> B2 ... Members should share setCount.
   */
  supersetGroup?: string;
  setCount: number;
  targetReps?: number;
  targetWeight?: number;
  targetDurationSeconds?: number;
  restSeconds: number;
  notes?: string;
  cue?: string;
};

export type WorkoutSessionStatus = "not_started" | "in_progress" | "completed" | "abandoned";

export type WorkoutSession = {
  id: string;
  userId: string;
  workoutPlanId: string;
  status: WorkoutSessionStatus;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
};

export type SetLogStatus = "completed" | "failed" | "skipped";
export type SetDifficulty = "easy" | "moderate" | "hard" | "brutal";
export type LoggedBy = "glasses_voice" | "mobile_voice" | "manual" | "gesture";

export type SetLog = {
  id: string;
  sessionId: string;
  workoutStepId: string;
  exerciseId: string;
  setNumber: number;
  targetWeight?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  actualWeight?: number;
  actualReps?: number;
  actualDurationSeconds?: number;
  unit: LogUnit;
  status: SetLogStatus;
  difficulty?: SetDifficulty;
  rpe?: number;
  note?: string;
  loggedBy: LoggedBy;
  transcript?: string;
  confidence?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type VoiceLogSource = "glasses_mic" | "mobile_mic";

export type VoiceLogAttempt = {
  id: string;
  sessionId: string;
  setLogId?: string;
  rawTranscript: string;
  parsedWeight?: number;
  parsedReps?: number;
  parsedUnit?: LogUnit;
  parsedDifficulty?: string;
  parsedStatus?: string;
  confidence: number;
  confirmed: boolean;
  correctionRequired: boolean;
  source: VoiceLogSource;
  createdAt: string;
};

export type WorkoutJournal = {
  id: string;
  sessionId: string;
  userId: string;
  energy?: "low" | "medium" | "high";
  soreness?: "none" | "mild" | "moderate" | "high";
  sleep?: "poor" | "okay" | "good";
  motivation?: "low" | "medium" | "high";
  preWorkoutMeal?: string;
  mealTimingMinutesBefore?: number;
  hydration?: "low" | "normal" | "high";
  supplements?: string;
  overallEffort?: SetDifficulty;
  moodAfter?: "worse" | "same" | "better";
  pain?: "none" | "mild" | "moderate" | "severe";
  bestLift?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
