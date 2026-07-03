"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Exercise } from "@setflow/shared";
import AppShell from "../../../../components/AppShell";
import ExerciseForm from "../../../../components/ExerciseForm";
import { getApi } from "../../../../lib/api";

export default function EditExercisePage() {
  const { id } = useParams<{ id: string }>();
  const [exercise, setExercise] = useState<Exercise | null | undefined>(undefined);

  useEffect(() => {
    getApi().getExercise(id).then(setExercise);
  }, [id]);

  return (
    <AppShell>
      <h1 style={{ margin: "0 0 16px", fontSize: 22 }}>Edit exercise</h1>
      {exercise === undefined ? (
        <div className="card" style={{ color: "var(--muted)" }}>Loading...</div>
      ) : exercise === null ? (
        <div className="card">Exercise not found.</div>
      ) : (
        <ExerciseForm existing={exercise} />
      )}
    </AppShell>
  );
}
