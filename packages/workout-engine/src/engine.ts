// Platform-agnostic workout state machine (build doc section 12).
// No timers, no storage, no SDK calls inside: the host platform drives time
// by calling tick() once per second and persists results via api-client.
// Every state derives exactly one GlassesCard, so any surface (mock preview,
// mobile player, real glasses) renders from the same snapshot.

import type {
  Exercise,
  GlassesCard,
  GlassesMedia,
  LogUnit,
  SetDifficulty,
  WorkoutPlan,
  WorkoutStep,
} from "@setflow/shared";

export type EngineStatus =
  | "idle"
  | "workout_preview"
  | "exercise_preview"
  | "demo"
  | "active_set"
  | "listening_for_log"
  | "confirming_log"
  | "resting"
  | "exercise_complete"
  | "workout_complete"
  | "paused";

/** One plan step joined with its exercise (and demo clip when it has one). */
export type EngineExerciseStep = {
  step: WorkoutStep;
  exercise: Exercise;
  demo?: GlassesMedia;
};

export type EngineWorkout = {
  plan: WorkoutPlan;
  steps: EngineExerciseStep[];
};

export type PendingLog = {
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  unit: LogUnit;
  /** "failed at 8" logs arrive as failed; default is completed. */
  status?: "completed" | "failed";
  difficulty?: SetDifficulty;
  note?: string;
  transcript?: string;
  confidence?: number;
};

export type EngineSetResult = {
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
  status: "completed" | "failed" | "skipped";
  difficulty?: SetDifficulty;
  note?: string;
  loggedBy: "manual" | "glasses_voice" | "mobile_voice" | "gesture";
  transcript?: string;
  confidence?: number;
};

export type EngineSnapshot = {
  status: EngineStatus;
  exerciseIndex: number;
  totalExercises: number;
  /** 1-based set number within the current exercise. */
  setNumber: number;
  /** Total sets in the current exercise. */
  setCount: number;
  restRemainingSeconds: number;
  results: EngineSetResult[];
  pendingLog: PendingLog | null;
  /** Session-time weight override for the current exercise, if the user set one. */
  weightOverride: number | null;
  /** Countdown within a timed set; null for rep-based sets. */
  setRemainingSeconds: number | null;
  card: GlassesCard;
};

export type EngineOptions = {
  unit?: LogUnit;
  /** Injectable clock for tests. Returns epoch milliseconds. */
  now?: () => number;
};

type Listener = (snapshot: EngineSnapshot) => void;

export class WorkoutEngine {
  private readonly plan: WorkoutPlan;
  private readonly steps: EngineExerciseStep[];
  private readonly unit: LogUnit;
  private readonly now: () => number;

  private status: EngineStatus = "idle";
  private pausedFrom: EngineStatus | null = null;
  private exerciseIndex = 0;
  private setNumber = 1;
  private restRemainingSeconds = 0;
  /** Countdown for timed sets; null for rep-based sets. */
  private setRemainingSeconds: number | null = null;
  private pendingLog: PendingLog | null = null;
  private results: EngineSetResult[] = [];
  /** Session-time weight adjustments, keyed by workout step id. */
  private weightOverrides = new Map<string, number>();
  /** Extra sets added on the fly this session, keyed by workout step id. */
  private extraSets = new Map<string, number>();
  private startedAtMs: number | null = null;
  private endedAtMs: number | null = null;
  private listeners: Listener[] = [];

  constructor(workout: EngineWorkout, options?: EngineOptions) {
    this.plan = workout.plan;
    this.steps = [...workout.steps].sort((a, b) => a.step.orderIndex - b.step.orderIndex);
    this.unit = options?.unit ?? "lb";
    this.now = options?.now ?? (() => Date.now());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }

  private get current(): EngineExerciseStep | undefined {
    return this.steps[this.exerciseIndex];
  }

  /** Effective target weight: the user's session override wins over the plan. */
  private targetWeightFor(step: EngineExerciseStep): number | undefined {
    return this.weightOverrides.get(step.step.id) ?? step.step.targetWeight;
  }

  /** Plan sets plus any added on the fly this session. */
  private setCountFor(step: EngineExerciseStep): number {
    return step.step.setCount + (this.extraSets.get(step.step.id) ?? 0);
  }

  /**
   * One more set of the current exercise, decided mid-workout. Works during
   * a set, during rest, and even during the between-exercise rest (it pulls
   * you back into this exercise instead of moving on).
   */
  addSet(): void {
    const step = this.current;
    if (!step) return;
    const allowed = [
      "exercise_preview",
      "demo",
      "active_set",
      "listening_for_log",
      "confirming_log",
      "resting",
      "exercise_complete",
    ];
    if (!allowed.includes(this.status)) return;
    this.extraSets.set(step.step.id, (this.extraSets.get(step.step.id) ?? 0) + 1);
    if (this.status === "exercise_complete") {
      // Was heading to the next exercise; stay here for the extra set instead.
      this.status = "resting";
    }
    this.notify();
  }

  /**
   * Change the working weight for the current exercise (all remaining sets
   * this session). Pass null to go back to the plan's target. The host app
   * persists it as the new default when the workout completes.
   */
  setWeightOverride(weight: number | null): void {
    const step = this.current;
    if (!step) return;
    const allowed = ["exercise_preview", "demo", "active_set", "listening_for_log"];
    if (!allowed.includes(this.status)) return;
    if (weight === null || !Number.isFinite(weight) || weight < 0) {
      this.weightOverrides.delete(step.step.id);
    } else {
      this.weightOverrides.set(step.step.id, weight);
    }
    this.notify();
  }

  /**
   * Jump directly to a specific exercise (out-of-order pickers, e.g. a
   * glasses/mobile "choose your exercise" summary screen). Resets the set
   * number to 1 and lands on that exercise's preview; already-logged results
   * for other exercises are untouched. No-op while idle, paused, or after the
   * workout is complete.
   */
  goToExercise(index: number): void {
    if (this.status === "idle" || this.status === "workout_complete" || this.status === "paused") return;
    if (this.steps.length === 0) return;
    this.exerciseIndex = Math.max(0, Math.min(index, this.steps.length - 1));
    this.setNumber = 1;
    this.pendingLog = null;
    this.restRemainingSeconds = 0;
    this.setRemainingSeconds = null;
    this.status = "exercise_preview";
    this.notify();
  }

  // --- navigation ----------------------------------------------------------

  /** idle → workout_preview (the "ready to start" card). */
  start(): void {
    if (this.status !== "idle") return;
    this.startedAtMs = this.now();
    this.status = this.steps.length === 0 ? "workout_complete" : "workout_preview";
    if (this.status === "workout_complete") this.endedAtMs = this.now();
    this.notify();
  }

  /** Enter the current set, arming the countdown when the set is timed. */
  private enterActiveSet(): void {
    this.status = "active_set";
    this.setRemainingSeconds = this.current?.step.targetDurationSeconds ?? null;
  }

  /** Generic forward: preview → first exercise; demo → set; rest → next set/exercise. */
  next(): void {
    switch (this.status) {
      case "workout_preview":
        this.status = "exercise_preview";
        break;
      case "exercise_preview":
      case "demo":
        this.enterActiveSet();
        break;
      case "resting":
      case "exercise_complete":
        this.advanceFromRest();
        return;
      default:
        return;
    }
    this.notify();
  }

  /** Step back: active set/demo → its preview; preview → previous exercise's preview. */
  previous(): void {
    switch (this.status) {
      case "confirming_log":
        // Bail out of a pending voice log back to the set.
        this.status = "active_set";
        this.pendingLog = null;
        break;
      case "demo":
      case "active_set":
      case "listening_for_log":
        this.status = "exercise_preview";
        this.pendingLog = null;
        break;
      case "exercise_preview":
        if (this.exerciseIndex === 0) return;
        this.exerciseIndex -= 1;
        this.setNumber = 1;
        break;
      default:
        return;
    }
    this.notify();
  }

  /** exercise_preview → demo (only when the exercise has a clip). */
  showDemo(): void {
    if (this.status !== "exercise_preview" && this.status !== "demo") return;
    if (!this.current?.demo) return;
    this.status = "demo";
    this.notify();
  }

  /** Enter the current set directly (same as next() from a preview/demo). */
  startSet(): void {
    if (this.status !== "exercise_preview" && this.status !== "demo") return;
    this.enterActiveSet();
    this.notify();
  }

  /** active_set → listening (voice logging UI). */
  startListening(): void {
    if (this.status !== "active_set") return;
    this.status = "listening_for_log";
    this.notify();
  }

  /** Cancel listening without logging. */
  stopListening(): void {
    if (this.status !== "listening_for_log") return;
    this.status = "active_set";
    this.notify();
  }

  /**
   * Manual completion (tap/gesture): records the set immediately using the
   * given actuals, falling back to the step's targets, then rests/advances.
   */
  completeSet(actuals?: Partial<Pick<PendingLog, "weight" | "reps" | "durationSeconds">>): void {
    if (this.status !== "active_set" && this.status !== "listening_for_log") return;
    const step = this.current;
    if (!step) return;
    this.recordResult({
      weight: actuals?.weight ?? this.targetWeightFor(step),
      reps: actuals?.reps ?? step.step.targetReps,
      durationSeconds: actuals?.durationSeconds ?? step.step.targetDurationSeconds,
      unit: this.unit,
      loggedBy: "manual",
      status: "completed",
    });
    this.advanceAfterSet();
  }

  /** A parsed voice log arrived: hold it for confirmation. */
  voiceLog(parsed: PendingLog): void {
    if (this.status !== "active_set" && this.status !== "listening_for_log") return;
    this.pendingLog = parsed;
    this.status = "confirming_log";
    this.notify();
  }

  /** Amend the pending voice log before confirming. */
  correctLog(fix: Partial<PendingLog>): void {
    if (this.status !== "confirming_log" || !this.pendingLog) return;
    this.pendingLog = { ...this.pendingLog, ...fix };
    this.notify();
  }

  /** Commit the pending voice log as this set's result. */
  confirmLog(source: "glasses_voice" | "mobile_voice" = "glasses_voice"): void {
    if (this.status !== "confirming_log" || !this.pendingLog) return;
    const p = this.pendingLog;
    this.pendingLog = null;
    this.recordResult({
      weight: p.weight,
      reps: p.reps,
      durationSeconds: p.durationSeconds,
      unit: p.unit,
      loggedBy: source,
      status: p.status ?? "completed",
      difficulty: p.difficulty,
      note: p.note,
      transcript: p.transcript,
      confidence: p.confidence,
    });
    this.advanceAfterSet();
  }

  /** Attach "that was brutal" / "add note ..." to the most recent logged set. */
  annotateLastResult(patch: { difficulty?: SetDifficulty; note?: string }): boolean {
    const last = this.results[this.results.length - 1];
    if (!last) return false;
    if (patch.difficulty !== undefined) last.difficulty = patch.difficulty;
    if (patch.note !== undefined) {
      last.note = last.note ? `${last.note}; ${patch.note}` : patch.note;
    }
    this.notify();
    return true;
  }

  /** Record the current set as skipped and move on. */
  skipSet(): void {
    if (!["active_set", "listening_for_log", "confirming_log", "resting"].includes(this.status)) return;
    if (this.status === "resting") {
      // Skipping during rest skips the UPCOMING set.
      this.setNumber += 1;
      this.status = "active_set";
    }
    this.pendingLog = null;
    this.recordResult({ unit: this.unit, loggedBy: "manual", status: "skipped" });
    this.advanceAfterSet();
  }

  /** Abandon the rest of the current exercise; unlogged sets become skipped. */
  skipExercise(): void {
    const active = [
      "exercise_preview",
      "demo",
      "active_set",
      "listening_for_log",
      "confirming_log",
      "resting",
      "exercise_complete",
    ];
    if (!active.includes(this.status)) return;
    const step = this.current;
    if (step && this.status !== "exercise_complete") {
      for (let s = this.setNumber; s <= this.setCountFor(step); s++) {
        this.results.push(this.buildResult(step, s, { unit: this.unit, loggedBy: "manual", status: "skipped" }));
      }
    }
    this.pendingLog = null;
    this.goToNextExercise();
  }

  /** Cut the rest short. */
  skipRest(): void {
    if (this.status !== "resting" && this.status !== "exercise_complete") return;
    this.advanceFromRest();
  }

  pause(): void {
    if (this.status === "paused" || this.status === "idle" || this.status === "workout_complete") return;
    this.pausedFrom = this.status;
    this.status = "paused";
    this.notify();
  }

  resume(): void {
    if (this.status !== "paused" || !this.pausedFrom) return;
    this.status = this.pausedFrom;
    this.pausedFrom = null;
    this.notify();
  }

  /** End the workout now, whatever state it's in. */
  end(): void {
    if (this.status === "workout_complete" || this.status === "idle") return;
    this.pendingLog = null;
    this.complete();
  }

  /** Advance time by one second: rest countdowns and timed-set countdowns. */
  tick(): void {
    if (this.status === "active_set" && this.setRemainingSeconds !== null) {
      this.setRemainingSeconds -= 1;
      if (this.setRemainingSeconds <= 0) {
        // Timed set finished: log it at the full duration.
        const step = this.current;
        this.setRemainingSeconds = null;
        this.completeSet({ durationSeconds: step?.step.targetDurationSeconds });
        return;
      }
      this.notify();
      return;
    }
    if (this.status !== "resting" && this.status !== "exercise_complete") return;
    if (this.restRemainingSeconds > 0) this.restRemainingSeconds -= 1;
    if (this.restRemainingSeconds <= 0) {
      this.advanceFromRest();
      return;
    }
    this.notify();
  }

  // --- internals -----------------------------------------------------------

  private buildResult(
    step: EngineExerciseStep,
    setNumber: number,
    partial: {
      weight?: number;
      reps?: number;
      durationSeconds?: number;
      unit: LogUnit;
      loggedBy: EngineSetResult["loggedBy"];
      status: EngineSetResult["status"];
      difficulty?: SetDifficulty;
      note?: string;
      transcript?: string;
      confidence?: number;
    }
  ): EngineSetResult {
    // Failed sets keep their actuals ("failed at 8" = did 8 reps); only
    // skipped sets record nothing.
    const attempted = partial.status !== "skipped";
    return {
      workoutStepId: step.step.id,
      exerciseId: step.exercise.id,
      setNumber,
      targetWeight: step.step.targetWeight,
      targetReps: step.step.targetReps,
      targetDurationSeconds: step.step.targetDurationSeconds,
      actualWeight: attempted ? partial.weight : undefined,
      actualReps: attempted ? partial.reps : undefined,
      actualDurationSeconds: attempted ? partial.durationSeconds : undefined,
      unit: partial.unit,
      status: partial.status,
      difficulty: partial.difficulty,
      note: partial.note,
      loggedBy: partial.loggedBy,
      transcript: partial.transcript,
      confidence: partial.confidence,
    };
  }

  private recordResult(partial: Parameters<WorkoutEngine["buildResult"]>[2]): void {
    const step = this.current;
    if (!step) return;
    this.results.push(this.buildResult(step, this.setNumber, partial));
  }

  /** Indices of the contiguous superset group containing the step, if any. */
  private groupFor(index: number): number[] | null {
    const g = this.steps[index]?.step.supersetGroup;
    if (!g) return null;
    const members: number[] = [index];
    for (let i = index - 1; i >= 0 && this.steps[i]?.step.supersetGroup === g; i--) {
      members.unshift(i);
    }
    for (let i = index + 1; i < this.steps.length && this.steps[i]?.step.supersetGroup === g; i++) {
      members.push(i);
    }
    return members.length > 1 ? members : null;
  }

  private advanceAfterSet(): void {
    const step = this.current;
    if (!step) return;

    // Superset round: A1 -> B1 (no rest) -> rest -> A2 -> B2 ...
    const group = this.groupFor(this.exerciseIndex);
    if (group) {
      const pos = group.indexOf(this.exerciseIndex);
      if (pos < group.length - 1) {
        this.exerciseIndex = group[pos + 1] ?? this.exerciseIndex;
        this.status = "exercise_preview";
        this.notify();
        return;
      }
      if (this.setNumber < this.setCountFor(step)) {
        // Round done: rest, then back to the group's first member.
        this.exerciseIndex = group[0] ?? this.exerciseIndex;
        this.status = "resting";
        this.restRemainingSeconds = step.step.restSeconds;
        if (this.restRemainingSeconds <= 0) {
          this.advanceFromRest();
          return;
        }
        this.notify();
        return;
      }
      this.goToNextExercise();
      return;
    }

    if (this.setNumber < this.setCountFor(step)) {
      // More sets in this exercise: rest, then the next set.
      this.status = "resting";
      this.restRemainingSeconds = step.step.restSeconds;
      if (this.restRemainingSeconds <= 0) {
        this.advanceFromRest();
        return;
      }
      this.notify();
      return;
    }
    this.goToNextExercise();
  }

  private goToNextExercise(): void {
    const step = this.current;
    if (this.exerciseIndex >= this.steps.length - 1) {
      this.complete();
      return;
    }
    // Between exercises: an exercise_complete rest using the finished step's rest time.
    this.status = "exercise_complete";
    this.restRemainingSeconds = step ? step.step.restSeconds : 0;
    if (this.restRemainingSeconds <= 0) {
      this.advanceFromRest();
      return;
    }
    this.notify();
  }

  private advanceFromRest(): void {
    if (this.status === "resting") {
      this.setNumber += 1;
      this.enterActiveSet();
    } else if (this.status === "exercise_complete") {
      this.exerciseIndex += 1;
      this.setNumber = 1;
      this.status = "exercise_preview";
    }
    this.restRemainingSeconds = 0;
    this.notify();
  }

  private complete(): void {
    this.status = "workout_complete";
    this.restRemainingSeconds = 0;
    this.endedAtMs = this.now();
    this.notify();
  }

  // --- snapshot / card generation -------------------------------------------

  elapsedSeconds(): number {
    if (this.startedAtMs === null) return 0;
    const end = this.endedAtMs ?? this.now();
    return Math.max(0, Math.round((end - this.startedAtMs) / 1000));
  }

  snapshot(): EngineSnapshot {
    const step = this.current;
    return {
      status: this.status,
      exerciseIndex: this.exerciseIndex,
      totalExercises: this.steps.length,
      setNumber: this.setNumber,
      setCount: step ? this.setCountFor(step) : 0,
      restRemainingSeconds: this.restRemainingSeconds,
      results: [...this.results],
      pendingLog: this.pendingLog ? { ...this.pendingLog } : null,
      weightOverride: step ? (this.weightOverrides.get(step.step.id) ?? null) : null,
      setRemainingSeconds: this.setRemainingSeconds,
      card: this.card(),
    };
  }

  private card(): GlassesCard {
    // While paused, keep showing the card of the state we paused from.
    const status = this.status === "paused" ? (this.pausedFrom ?? "workout_preview") : this.status;
    const step = this.current;

    switch (status) {
      case "idle":
      case "workout_preview":
        return {
          kind: "workout_start",
          workoutTitle: this.plan.title,
          exerciseCount: this.steps.length,
          estimatedMinutes: this.plan.estimatedDurationMinutes,
        };
      case "exercise_preview":
        return {
          kind: "exercise_preview",
          exerciseName: step?.exercise.name ?? "",
          setCount: step ? this.setCountFor(step) : 0,
          targetReps: step?.step.targetReps,
          restSeconds: step?.step.restSeconds ?? 0,
          hasDemo: Boolean(step?.demo),
        };
      case "demo":
        return {
          kind: "demo",
          exerciseName: step?.exercise.name ?? "",
          demoDurationSeconds: step?.demo?.durationSeconds,
          cue: step?.step.cue ?? step?.exercise.cues?.[0],
          media: step?.demo,
        };
      case "active_set":
        return {
          kind: "active_set",
          exerciseName: step?.exercise.name ?? "",
          setNumber: this.setNumber,
          setCount: step ? this.setCountFor(step) : 0,
          targetWeight: step ? this.targetWeightFor(step) : undefined,
          targetReps: step?.step.targetReps,
          targetDurationSeconds: step?.step.targetDurationSeconds,
          remainingSeconds: this.setRemainingSeconds ?? undefined,
          unit: this.unit,
        };
      case "listening_for_log": {
        const w = (step ? this.targetWeightFor(step) : undefined) ?? 75;
        const r = step?.step.targetReps ?? 10;
        return { kind: "listening", examplePhrase: `Say: "${w} for ${r}"` };
      }
      case "confirming_log":
        return {
          kind: "confirmation",
          loggedWeight: this.pendingLog?.weight,
          loggedReps: this.pendingLog?.reps,
          unit: this.pendingLog?.unit ?? this.unit,
          restSeconds: step?.step.restSeconds ?? 0,
        };
      case "resting":
        return {
          kind: "rest",
          remainingSeconds: this.restRemainingSeconds,
          nextLabel: `Set ${this.setNumber + 1}`,
          exerciseName: step?.exercise.name ?? "",
        };
      case "exercise_complete": {
        const nextStep = this.steps[this.exerciseIndex + 1];
        return {
          kind: "rest",
          remainingSeconds: this.restRemainingSeconds,
          nextLabel: nextStep?.exercise.name ?? "Done",
        };
      }
      case "workout_complete": {
        const completed = this.results.filter((r) => r.status === "completed").length;
        const skipped = this.results.some((r) => r.status === "skipped");
        return {
          kind: "workout_complete",
          durationMinutes: Math.round(this.elapsedSeconds() / 60),
          totalSets: completed,
          message: skipped ? "Nice work - some sets were skipped." : "Nice work!",
        };
      }
      default:
        return {
          kind: "workout_start",
          workoutTitle: this.plan.title,
          exerciseCount: this.steps.length,
          estimatedMinutes: this.plan.estimatedDurationMinutes,
        };
    }
  }
}

export function createWorkoutEngine(workout: EngineWorkout, options?: EngineOptions): WorkoutEngine {
  return new WorkoutEngine(workout, options);
}
