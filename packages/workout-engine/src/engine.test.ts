// Segment 08 acceptance tests: core state transitions, set advancement,
// exercise/workout completion, and card generation.
// Run: npm --workspace @setflow/workout-engine run test

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Exercise, WorkoutPlan, WorkoutStep } from "@setflow/shared";
import { createWorkoutEngine, type EngineWorkout } from "./engine.ts";

const ts = "2026-07-02T00:00:00.000Z";

function exercise(id: string, name: string): Exercise {
  return { id, name, cues: [`${name} cue`], createdAt: ts, updatedAt: ts };
}

function step(id: string, exerciseId: string, orderIndex: number, over?: Partial<WorkoutStep>): WorkoutStep {
  return {
    id,
    workoutPlanId: "plan-1",
    exerciseId,
    orderIndex,
    setCount: 2,
    targetReps: 10,
    targetWeight: 75,
    restSeconds: 60,
    ...over,
  };
}

const plan: WorkoutPlan = {
  id: "plan-1",
  ownerUserId: "user-1",
  title: "Test Day",
  estimatedDurationMinutes: 30,
  createdAt: ts,
  updatedAt: ts,
};

function sampleWorkout(): EngineWorkout {
  const bench = exercise("ex-1", "Bench Press");
  const row = exercise("ex-2", "Barbell Row");
  return {
    plan,
    steps: [
      { step: step("st-1", "ex-1", 0, { cue: "Elbows tucked" }), exercise: bench },
      {
        step: step("st-2", "ex-2", 1, { setCount: 1 }),
        exercise: row,
        demo: { url: "https://example.com/row.mp4", mediaType: "video", durationSeconds: 12 },
      },
    ],
  };
}

/** Fixed clock so duration math is deterministic. */
function fixedNow(startMs = 1_000_000): { now: () => number; advance: (s: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (s: number) => (t += s * 1000) };
}

test("start shows the workout_start card", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  assert.equal(engine.snapshot().status, "idle");
  engine.start();
  const snap = engine.snapshot();
  assert.equal(snap.status, "workout_preview");
  assert.deepEqual(snap.card, {
    kind: "workout_start",
    workoutTitle: "Test Day",
    exerciseCount: 2,
    estimatedMinutes: 30,
  });
});

test("full happy path: 2 exercises, sets advance, correct cards, completes", () => {
  const clock = fixedNow();
  const engine = createWorkoutEngine(sampleWorkout(), { now: clock.now });
  engine.start();
  engine.next(); // exercise_preview

  let snap = engine.snapshot();
  assert.equal(snap.status, "exercise_preview");
  assert.deepEqual(snap.card, {
    kind: "exercise_preview",
    exerciseName: "Bench Press",
    setCount: 2,
    targetReps: 10,
    restSeconds: 60,
    hasDemo: false,
  });

  engine.startSet(); // set 1 of Bench
  snap = engine.snapshot();
  assert.equal(snap.status, "active_set");
  assert.equal(snap.card.kind, "active_set");
  assert.equal(snap.setNumber, 1);

  engine.completeSet({ weight: 80, reps: 9 });
  snap = engine.snapshot();
  assert.equal(snap.status, "resting");
  assert.deepEqual(snap.card, {
    kind: "rest",
    remainingSeconds: 60,
    nextLabel: "Set 2",
    exerciseName: "Bench Press",
  });

  // Rest counts down and auto-advances to set 2.
  for (let i = 0; i < 60; i++) engine.tick();
  snap = engine.snapshot();
  assert.equal(snap.status, "active_set");
  assert.equal(snap.setNumber, 2);

  engine.completeSet(); // last set of Bench -> exercise_complete rest toward Row
  snap = engine.snapshot();
  assert.equal(snap.status, "exercise_complete");
  assert.equal(snap.card.kind, "rest");
  assert.equal((snap.card as { nextLabel: string }).nextLabel, "Barbell Row");

  engine.skipRest(); // straight to Row's preview
  snap = engine.snapshot();
  assert.equal(snap.status, "exercise_preview");
  assert.equal((snap.card as { exerciseName: string }).exerciseName, "Barbell Row");
  assert.equal((snap.card as { hasDemo: boolean }).hasDemo, true);

  engine.showDemo();
  snap = engine.snapshot();
  assert.equal(snap.status, "demo");
  assert.equal(snap.card.kind, "demo");

  engine.next(); // demo -> active_set
  clock.advance(1800); // 30 minutes of lifting
  engine.completeSet(); // only set of Row -> workout done

  snap = engine.snapshot();
  assert.equal(snap.status, "workout_complete");
  assert.deepEqual(snap.card, {
    kind: "workout_complete",
    durationMinutes: 30,
    totalSets: 3,
    message: "Nice work!",
  });
  assert.equal(snap.results.length, 3);
  assert.equal(snap.results[0]?.actualWeight, 80);
  assert.equal(snap.results[0]?.actualReps, 9);
  assert.equal(snap.results[1]?.actualWeight, 75); // defaulted to target
});

test("voice log flow: listen, receive, correct, confirm", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();

  engine.startListening();
  let snap = engine.snapshot();
  assert.equal(snap.status, "listening_for_log");
  assert.deepEqual(snap.card, { kind: "listening", examplePhrase: 'Say: "75 for 10"' });

  engine.voiceLog({ weight: 70, reps: 8, unit: "lb", transcript: "70 for 8", confidence: 0.92 });
  snap = engine.snapshot();
  assert.equal(snap.status, "confirming_log");
  assert.equal(snap.card.kind, "confirmation");
  assert.equal((snap.card as { loggedWeight?: number }).loggedWeight, 70);

  engine.correctLog({ reps: 9 });
  assert.equal(engine.snapshot().pendingLog?.reps, 9);

  engine.confirmLog("glasses_voice");
  snap = engine.snapshot();
  assert.equal(snap.status, "resting");
  const logged = snap.results[0];
  assert.equal(logged?.actualWeight, 70);
  assert.equal(logged?.actualReps, 9);
  assert.equal(logged?.loggedBy, "glasses_voice");
  assert.equal(logged?.transcript, "70 for 8");
});

test("pause freezes the card and tick; resume restores", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  engine.completeSet(); // resting, 60s

  engine.pause();
  let snap = engine.snapshot();
  assert.equal(snap.status, "paused");
  assert.equal(snap.card.kind, "rest"); // still shows the rest card

  engine.tick();
  engine.tick();
  assert.equal(engine.snapshot().restRemainingSeconds, 60); // paused: no countdown

  engine.resume();
  snap = engine.snapshot();
  assert.equal(snap.status, "resting");
  engine.tick();
  assert.equal(engine.snapshot().restRemainingSeconds, 59);
});

test("skipSet records a skipped result and advances", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  engine.skipSet(); // set 1 skipped -> resting toward set 2

  const snap = engine.snapshot();
  assert.equal(snap.status, "resting");
  assert.equal(snap.results[0]?.status, "skipped");
  assert.equal(snap.results[0]?.actualWeight, undefined);
});

test("skipExercise marks remaining sets skipped and jumps to the next exercise", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  engine.skipExercise(); // both Bench sets skipped

  const snap = engine.snapshot();
  assert.equal(snap.results.length, 2);
  assert.ok(snap.results.every((r) => r.status === "skipped"));
  // Lands on the between-exercise rest, then the Row preview.
  engine.skipRest();
  assert.equal(engine.snapshot().status, "exercise_preview");
  assert.equal((engine.snapshot().card as { exerciseName: string }).exerciseName, "Barbell Row");
});

test("end finishes early and flags skipped sets in the message", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  engine.skipSet();
  engine.end();

  const snap = engine.snapshot();
  assert.equal(snap.status, "workout_complete");
  assert.equal(snap.card.kind, "workout_complete");
  assert.match((snap.card as { message?: string }).message ?? "", /skipped/);
});

test("previous steps back from a set to the preview and between previews", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  engine.previous();
  assert.equal(engine.snapshot().status, "exercise_preview");
  engine.previous(); // already at the first exercise: no-op
  assert.equal(engine.snapshot().status, "exercise_preview");
  assert.equal(engine.snapshot().exerciseIndex, 0);
});

test("empty workout completes immediately on start", () => {
  const engine = createWorkoutEngine({ plan, steps: [] });
  engine.start();
  assert.equal(engine.snapshot().status, "workout_complete");
});

test("steps are ordered by orderIndex regardless of input order", () => {
  const w = sampleWorkout();
  w.steps.reverse();
  const engine = createWorkoutEngine(w);
  engine.start();
  engine.next();
  assert.equal((engine.snapshot().card as { exerciseName: string }).exerciseName, "Bench Press");
});

test("subscribe fires on every transition", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  const seen: string[] = [];
  const unsubscribe = engine.subscribe((s) => seen.push(s.status));
  engine.start();
  engine.next();
  engine.startSet();
  unsubscribe();
  engine.completeSet();
  assert.deepEqual(seen, ["workout_preview", "exercise_preview", "active_set"]);
});

test("active_set and rest cards always carry the exercise name", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next();
  engine.startSet();
  const setCard = engine.snapshot().card;
  assert.equal(setCard.kind, "active_set");
  assert.equal((setCard as { exerciseName: string }).exerciseName, "Bench Press");
  engine.completeSet();
  const restCard = engine.snapshot().card;
  assert.equal(restCard.kind, "rest");
  assert.equal((restCard as { exerciseName?: string }).exerciseName, "Bench Press");
});

test("weight override drives the card, the phrase, and the logged actuals - plan target stays", () => {
  const engine = createWorkoutEngine(sampleWorkout());
  engine.start();
  engine.next(); // Bench preview (plan target 75)
  engine.setWeightOverride(80);
  assert.equal(engine.snapshot().weightOverride, 80);

  engine.startSet();
  const card = engine.snapshot().card;
  assert.equal((card as { targetWeight?: number }).targetWeight, 80);

  engine.startListening();
  assert.equal(
    (engine.snapshot().card as { examplePhrase: string }).examplePhrase,
    'Say: "80 for 10"'
  );
  engine.stopListening();

  engine.completeSet(); // no explicit actuals -> defaults to the override
  const logged = engine.snapshot().results[0];
  assert.equal(logged?.actualWeight, 80);
  assert.equal(logged?.targetWeight, 75); // the plan's target is preserved for reporting

  // Override persists for the next set of the same exercise.
  engine.skipRest();
  assert.equal((engine.snapshot().card as { targetWeight?: number }).targetWeight, 80);

  // Clearing goes back to the plan target.
  engine.setWeightOverride(null);
  assert.equal((engine.snapshot().card as { targetWeight?: number }).targetWeight, 75);
});

test("zero rest advances immediately without a rest state", () => {
  const w = sampleWorkout();
  const first = w.steps[0];
  if (!first) throw new Error("sample missing steps");
  first.step.restSeconds = 0;
  const engine = createWorkoutEngine(w);
  engine.start();
  engine.next();
  engine.startSet();
  engine.completeSet();
  const snap = engine.snapshot();
  assert.equal(snap.status, "active_set");
  assert.equal(snap.setNumber, 2);
});
