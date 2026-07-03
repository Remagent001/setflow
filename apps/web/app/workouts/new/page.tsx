import AppShell from "../../../components/AppShell";
import WorkoutPlanForm from "../../../components/WorkoutPlanForm";

export default function NewWorkoutPage() {
  return (
    <AppShell>
      <h1 style={{ margin: "0 0 16px", fontSize: 22 }}>New workout</h1>
      <WorkoutPlanForm />
    </AppShell>
  );
}
