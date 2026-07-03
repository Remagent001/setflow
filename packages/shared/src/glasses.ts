// Glasses-facing types: capabilities, cards, media, gestures, voice capture.
// The glasses UI is a sequence of CARDS, not pages (build doc section 6).
// Every capability may be absent on a given device - features must degrade
// gracefully (build doc section 4).

export type GlassesCapabilities = {
  displayCards: boolean;
  playShortVideo: boolean;
  playAudioCues: boolean;
  captureMicrophone: boolean;
  captureCamera: boolean;
  gestures: boolean;
  offlineMediaCache: boolean;
};

/** One card per screen state, mirroring build doc section 6 exactly. */
export type GlassesCard =
  | {
      kind: "workout_start";
      workoutTitle: string;
      exerciseCount: number;
      estimatedMinutes?: number;
    }
  | {
      kind: "exercise_preview";
      exerciseName: string;
      setCount: number;
      targetReps?: number;
      restSeconds: number;
      hasDemo: boolean;
    }
  | {
      kind: "demo";
      exerciseName: string;
      demoDurationSeconds?: number;
      cue?: string;
    }
  | {
      kind: "active_set";
      setNumber: number;
      setCount: number;
      targetWeight?: number;
      targetReps?: number;
      targetDurationSeconds?: number;
      unit: "lb" | "kg" | "bodyweight";
    }
  | {
      kind: "listening";
      /** e.g. `Say: "75 for 10"` */
      examplePhrase: string;
    }
  | {
      kind: "confirmation";
      loggedWeight?: number;
      loggedReps?: number;
      unit: "lb" | "kg" | "bodyweight";
      restSeconds: number;
    }
  | {
      kind: "correction";
      /** Two or more interpretations for the user to pick between. */
      options: Array<{ weight?: number; reps?: number; unit: "lb" | "kg" | "bodyweight" }>;
    }
  | {
      kind: "rest";
      remainingSeconds: number;
      /** e.g. "Set 3" or "Incline Dumbbell Press" */
      nextLabel: string;
    }
  | {
      kind: "workout_complete";
      durationMinutes: number;
      totalSets: number;
      message?: string;
    };

export type GlassesMedia = {
  url: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  mediaType: "video" | "image";
};

export type AudioCue = {
  kind: "countdown" | "start_set" | "rest_over" | "confirm" | "error";
  text?: string;
};

export type GlassesGesture =
  | "tap"
  | "double_tap"
  | "swipe_forward"
  | "swipe_back"
  | "pinch"
  | "long_press";

export type VoiceCaptureResult = {
  transcript: string;
  /** 0..1 from the speech-to-text layer; drives confirm-vs-correct flow. */
  confidence: number;
  source: "glasses_mic" | "mobile_mic";
};
