// Segment 12 acceptance tests: every supported phrase from build doc 7.1,
// plus number words, gym shorthand, ambiguity handling, and resolution.
// Run: npm --workspace @setflow/workout-engine run test

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVoiceLog, resolveVoiceLog, type VoiceLogContext } from "./voice-parser.ts";

test('"75 for 10" - the canonical log', () => {
  const p = parseVoiceLog("75 for 10");
  assert.equal(p.intent, "log");
  assert.equal(p.weight, 75);
  assert.equal(p.reps, 10);
  assert.equal(p.status, "completed");
  assert.ok(p.confidence >= 0.9);
});

test('"75 pounds, 10 reps"', () => {
  const p = parseVoiceLog("75 pounds, 10 reps");
  assert.equal(p.intent, "log");
  assert.equal(p.weight, 75);
  assert.equal(p.reps, 10);
  assert.equal(p.unit, "lb");
});

test('"seventy five for ten" - spoken numbers', () => {
  const p = parseVoiceLog("seventy five for ten");
  assert.equal(p.weight, 75);
  assert.equal(p.reps, 10);
});

test('"two twenty five for eight" - gym shorthand hundreds', () => {
  const p = parseVoiceLog("two twenty five for eight");
  assert.equal(p.weight, 225);
  assert.equal(p.reps, 8);
});

test('"a hundred and five for five"', () => {
  const p = parseVoiceLog("a hundred and five for five");
  assert.equal(p.weight, 105);
  assert.equal(p.reps, 5);
});

test('"100 kilos for 5" - kg unit', () => {
  const p = parseVoiceLog("100 kilos for 5");
  assert.equal(p.weight, 100);
  assert.equal(p.unit, "kg");
});

test('"22.5 for 12" - decimal weights', () => {
  const p = parseVoiceLog("22.5 for 12");
  assert.equal(p.weight, 22.5);
  assert.equal(p.reps, 12);
});

test('"same as last set"', () => {
  const p = parseVoiceLog("same as last set");
  assert.equal(p.intent, "same_as_last");
  assert.ok(p.confidence >= 0.85);
});

test('"bodyweight for 15"', () => {
  const p = parseVoiceLog("bodyweight for 15");
  assert.equal(p.intent, "log");
  assert.equal(p.bodyweight, true);
  assert.equal(p.reps, 15);
  assert.equal(p.weight, undefined);
});

test('"failed at 8"', () => {
  const p = parseVoiceLog("failed at 8");
  assert.equal(p.intent, "log");
  assert.equal(p.reps, 8);
  assert.equal(p.status, "failed");
});

test('"skip this set"', () => {
  const p = parseVoiceLog("skip this set");
  assert.equal(p.intent, "skip");
});

test('"that was easy" / "that was brutal" - difficulty', () => {
  assert.equal(parseVoiceLog("that was easy").difficulty, "easy");
  assert.equal(parseVoiceLog("that was easy").intent, "difficulty");
  assert.equal(parseVoiceLog("that was brutal").difficulty, "brutal");
  assert.equal(parseVoiceLog("too heavy").difficulty, "hard");
});

test('"add note shoulder felt tight"', () => {
  const p = parseVoiceLog("add note shoulder felt tight");
  assert.equal(p.intent, "note");
  assert.equal(p.note, "shoulder felt tight");
});

test('"80 for 6, that was brutal" - difficulty rides along with a log', () => {
  const p = parseVoiceLog("80 for 6, that was brutal");
  assert.equal(p.intent, "log");
  assert.equal(p.weight, 80);
  assert.equal(p.reps, 6);
  assert.equal(p.difficulty, "brutal");
});

test('"10 reps" - reps only, lower confidence', () => {
  const p = parseVoiceLog("10 reps");
  assert.equal(p.intent, "log");
  assert.equal(p.reps, 10);
  assert.equal(p.weight, undefined);
  assert.ok(p.confidence < 0.9 && p.confidence >= 0.6);
});

test("gibberish is unknown with near-zero confidence, never a throw", () => {
  const p = parseVoiceLog("purple monkey dishwasher");
  assert.equal(p.intent, "unknown");
  assert.ok(p.confidence <= 0.2);
  assert.equal(parseVoiceLog("").intent, "unknown");
  assert.equal(parseVoiceLog("   ").confidence, 0);
});

test("single bare number guesses reps in rep range, weight above it", () => {
  const reps = parseVoiceLog("ten");
  assert.equal(reps.reps, 10);
  assert.ok(reps.confidence < 0.6);
  const weight = parseVoiceLog("185");
  assert.equal(weight.weight, 185);
});

// --- resolution -----------------------------------------------------------------

const ctx: VoiceLogContext = {
  lastWeight: 80,
  lastReps: 9,
  targetWeight: 75,
  targetReps: 10,
  unit: "lb",
};

test("resolve: same_as_last copies the previous set", () => {
  const r = resolveVoiceLog(parseVoiceLog("same as last set"), ctx);
  assert.equal(r.action, "pending");
  if (r.action === "pending") {
    assert.equal(r.pending.weight, 80);
    assert.equal(r.pending.reps, 9);
  }
});

test("resolve: reps-only log borrows weight from context", () => {
  const r = resolveVoiceLog(parseVoiceLog("12 reps"), ctx);
  assert.equal(r.action, "pending");
  if (r.action === "pending") {
    assert.equal(r.pending.weight, 80); // last lifted wins over plan target
    assert.equal(r.pending.reps, 12);
  }
});

test("resolve: bodyweight log carries the bodyweight unit and no weight", () => {
  const r = resolveVoiceLog(parseVoiceLog("bodyweight for 15"), ctx);
  assert.equal(r.action, "pending");
  if (r.action === "pending") {
    assert.equal(r.pending.unit, "bodyweight");
    assert.equal(r.pending.weight, undefined);
    assert.equal(r.pending.reps, 15);
  }
});

test("resolve: skip, note, difficulty, and unknown map to their actions", () => {
  assert.equal(resolveVoiceLog(parseVoiceLog("skip this set"), ctx).action, "skip");
  assert.equal(resolveVoiceLog(parseVoiceLog("add note felt strong"), ctx).action, "note");
  assert.equal(resolveVoiceLog(parseVoiceLog("that was brutal"), ctx).action, "difficulty");
  assert.equal(resolveVoiceLog(parseVoiceLog("purple monkey"), ctx).action, "unclear");
});

test("resolve: failed log keeps failed status", () => {
  const r = resolveVoiceLog(parseVoiceLog("failed at 8"), ctx);
  assert.equal(r.action, "pending");
  if (r.action === "pending") {
    assert.equal(r.pending.status, "failed");
    assert.equal(r.pending.reps, 8);
    assert.equal(r.pending.weight, 80);
  }
});
