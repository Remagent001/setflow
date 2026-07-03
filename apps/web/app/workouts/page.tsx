"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorkoutPlan } from "@setflow/shared";
import AppShell from "../../components/AppShell";
import { getApi } from "../../lib/api";

type PlanRow = WorkoutPlan & { stepCount: number };

export default function WorkoutsPage() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);

  useEffect(() => {
    const api = getApi();
    api.listWorkoutPlans().then(async (list) => {
      const rows = await Promise.all(
        list.map(async (p) => {
          const full = await api.getWorkoutPlan(p.id);
          return { ...p, stepCount: full?.steps.length ?? 0 };
        })
      );
      setPlans(rows);
    });
  }, []);

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Workouts</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Your workout plans - ordered exercise sequences the player will run.
          </p>
        </div>
        <Link href="/workouts/new" className="btn" style={{ display: "inline-block" }}>
          + New workout
        </Link>
      </div>

      {plans === null ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>Loading...</div>
      ) : plans.length === 0 ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>
          No workouts yet - create your first one.
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
          {plans.map((p) => (
            <Link key={p.id} href={`/workouts/${p.id}`} className="card" style={{ display: "block" }}>
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {p.stepCount} exercise{p.stepCount === 1 ? "" : "s"}
                {p.estimatedDurationMinutes ? ` · ~${p.estimatedDurationMinutes} min` : ""}
                {p.difficulty ? ` · ${p.difficulty}` : ""}
              </div>
              {p.description && (
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  {p.description}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
