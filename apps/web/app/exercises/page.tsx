"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Exercise } from "@setflow/shared";
import AppShell from "../../components/AppShell";
import { getApi } from "../../lib/api";

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[] | null>(null);

  useEffect(() => {
    getApi().listExercises().then(setExercises);
  }, []);

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Exercises</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Your movement library - cues and mistakes feed the glasses demo cards.
          </p>
        </div>
        <Link href="/exercises/new" className="btn" style={{ display: "inline-block" }}>
          + New exercise
        </Link>
      </div>

      {exercises === null ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>Loading...</div>
      ) : exercises.length === 0 ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>
          No exercises yet - create your first one.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
            marginTop: 18,
          }}
        >
          {exercises.map((e) => (
            <Link
              key={e.id}
              href={`/exercises/${e.id}`}
              className="card"
              style={{ display: "block" }}
            >
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {e.primaryMuscleGroup ?? "No muscle group"}
                {e.equipment?.length ? ` · ${e.equipment.join(", ")}` : ""}
              </div>
              {e.cues?.length ? (
                <div style={{ color: "var(--green)", fontSize: 12, marginTop: 8 }}>
                  {e.cues.length} cue{e.cues.length === 1 ? "" : "s"}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
