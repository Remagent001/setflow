// @setflow/workout-engine - the platform-agnostic workout state machine
// (build doc section 12). Consumed by the mobile player (Segment 11) and the
// glasses adapter preview (Segment 09).

export {
  WorkoutEngine,
  createWorkoutEngine,
  type EngineStatus,
  type EngineExerciseStep,
  type EngineWorkout,
  type EngineOptions,
  type EngineSnapshot,
  type EngineSetResult,
  type PendingLog,
} from "./engine";

export {
  parseVoiceLog,
  resolveVoiceLog,
  type ParsedVoiceLog,
  type ResolvedVoiceLog,
  type VoiceIntent,
  type VoiceLogContext,
} from "./voice-parser";
