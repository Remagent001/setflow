"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Exercise } from "@setflow/shared";
import AppShell from "../../../components/AppShell";
import ExerciseMediaSection from "../../../components/ExerciseMediaSection";
import { getApi } from "../../../lib/api";

export default function ExerciseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [exercise, setExercise] = useState<Exercise | null | undefined>(undefined);

  useEffect(() => {
    getApi().getExercise(id).then(setExercise);
  }, [id]);

  if (exercise === undefined) {
    return (
      <AppShell>
        <div className="card" style={{ color: "var(--muted)" }}>Loading...</div>
      </AppShell>
    );
  }
  if (exercise === null) {
    return (
      <AppShell>
        <div className="card">Exercise not found.</div>
      </AppShell>
    );
  }

  const section = (title: string, items?: string[]) =>
    items && items.length > 0 ? (
      <div>
        <h3 style={{ margin: "16px 0 6px", fontSize: 14, color: "var(--accent)" }}>{title}</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text)" }}>
          {items.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{exercise.name}</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {exercise.primaryMuscleGroup ?? "No muscle group"}
            {exercise.secondaryMuscleGroups?.length
              ? ` · also: ${exercise.secondaryMuscleGroups.join(", ")}`
              : ""}
            {exercise.equipment?.length ? ` · ${exercise.equipment.join(", ")}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/exercises/${exercise.id}/edit`} className="btn">
            Edit
          </Link>
          <button
            className="btn"
            style={{ background: "var(--panel2)", color: "#ff7a7a" }}
            onClick={async () => {
              if (!window.confirm(`Delete "${exercise.name}"?`)) return;
              await getApi().deleteExercise(exercise.id);
              router.push("/exercises");
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18, maxWidth: 620 }}>
        {exercise.description && <p style={{ margin: 0 }}>{exercise.description}</p>}
        {exercise.instructions && (
          <div>
            <h3 style={{ margin: "16px 0 6px", fontSize: 14, color: "var(--accent)" }}>
              Instructions
            </h3>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{exercise.instructions}</p>
          </div>
        )}
        {section("Cues", exercise.cues)}
        {section("Common mistakes", exercise.commonMistakes)}
        {!exercise.description &&
          !exercise.instructions &&
          !exercise.cues?.length &&
          !exercise.commonMistakes?.length && (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No details yet - hit Edit to add cues and instructions.
            </p>
          )}
        <ExerciseMediaSection exerciseId={exercise.id} />
      </div>
    </AppShell>
  );
}
