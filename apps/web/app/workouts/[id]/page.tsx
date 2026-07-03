"use client";

// Workout plan page = the builder. Plan header + the ordered step sequence
// (add / reorder / configure / remove) via WorkoutStepBuilder.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { WorkoutPlan } from "@setflow/shared";
import AppShell from "../../../components/AppShell";
import WorkoutStepBuilder from "../../../components/WorkoutStepBuilder";
import { getApi } from "../../../lib/api";

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<WorkoutPlan | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    getApi().getWorkoutPlan(id).then(setPlan);
  }, [id]);

  if (plan === undefined) {
    return (
      <AppShell>
        <div className="card" style={{ color: "var(--muted)" }}>Loading...</div>
      </AppShell>
    );
  }
  if (plan === null) {
    return (
      <AppShell>
        <div className="card">Workout not found.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{plan.title}</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {plan.difficulty ? `${plan.difficulty} · ` : ""}
            {plan.estimatedDurationMinutes ? `~${plan.estimatedDurationMinutes} min · ` : ""}
            {plan.description || "No description"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <Link
            href={`/workouts/${plan.id}/edit`}
            className="btn"
            style={{ background: "var(--panel2)", color: "var(--text)", display: "inline-block" }}
          >
            Edit details
          </Link>
          {confirmDelete ? (
            <button
              type="button"
              className="btn"
              style={{ background: "#e5534b", color: "#fff" }}
              onClick={async () => {
                await getApi().deleteWorkoutPlan(plan.id);
                router.push("/workouts");
              }}
            >
              Really delete?
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              style={{ background: "var(--panel2)", color: "#ff7a7a" }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <WorkoutStepBuilder planId={plan.id} />
    </AppShell>
  );
}
