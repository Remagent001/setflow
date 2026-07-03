// Timer configuration types. Standard rest timers ship first; the richer
// formats (intervals, supersets, EMOM/AMRAP) arrive in Segment 18.

export type TimerKind =
  | "rest"
  | "timed_set"
  | "work_rest_interval"
  | "emom" // placeholder until Segment 18
  | "amrap"; // placeholder until Segment 18

export type TimerPreset = {
  id: string;
  name: string;
  kind: TimerKind;
  /** Seconds of work, for timed sets / intervals. */
  workSeconds?: number;
  /** Seconds of rest between sets or intervals. */
  restSeconds?: number;
  /** Number of rounds, for interval formats. */
  rounds?: number;
};
