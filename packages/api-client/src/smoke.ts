// Segment 03 acceptance smoke test (mock mode, no backend needed):
// fetch the sample workout, start a session, save a set log, read it back.
// Run: npm --workspace @setflow/api-client run smoke

// .ts extension is required for running directly under Node's type stripping.
import { createMockApiClient } from "./mock.ts";

const api = createMockApiClient();

const plans = await api.listWorkoutPlans();
const firstPlan = plans[0];
if (!firstPlan) throw new Error("FAIL: no sample workout plan in mock");

const plan = await api.getWorkoutPlan(firstPlan.id);
if (!plan || plan.steps.length !== 3) throw new Error("FAIL: sample plan should have 3 steps");
console.log(`workout fetched: "${plan.title}" with ${plan.steps.length} steps`);

const session = await api.startSession("mock-user", plan.id);
if (session.status !== "in_progress") throw new Error("FAIL: session not in progress");
console.log(`session created: ${session.id} (${session.status})`);

const step = plan.steps[0]!;
const log = await api.createSetLog({
  sessionId: session.id,
  workoutStepId: step.id,
  exerciseId: step.exerciseId,
  setNumber: 1,
  targetWeight: step.targetWeight,
  targetReps: step.targetReps,
  actualWeight: 75,
  actualReps: 10,
  unit: "lb",
  status: "completed",
  loggedBy: "manual",
});
console.log(`set log saved: ${log.actualWeight} lb x ${log.actualReps}`);

const logs = await api.listSetLogs(session.id);
if (logs.length !== 1) throw new Error("FAIL: expected 1 set log");

const done = await api.completeSession(session.id, 47 * 60);
if (done.status !== "completed") throw new Error("FAIL: session not completed");

const summary = await api.getDashboardSummary("mock-user");
if (summary.totalVolume !== 750) throw new Error(`FAIL: volume ${summary.totalVolume} != 750`);
console.log(`session completed; dashboard volume = ${summary.totalVolume} lb`);
console.log("SMOKE PASS");
