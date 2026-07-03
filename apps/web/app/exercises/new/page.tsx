"use client";

import AppShell from "../../../components/AppShell";
import ExerciseForm from "../../../components/ExerciseForm";

export default function NewExercisePage() {
  return (
    <AppShell>
      <h1 style={{ margin: "0 0 16px", fontSize: 22 }}>New exercise</h1>
      <ExerciseForm />
    </AppShell>
  );
}
