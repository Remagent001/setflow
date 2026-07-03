"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { WorkoutPlan } from "@setflow/shared";
import AppShell from "../../../../components/AppShell";
import WorkoutPlanForm from "../../../../components/WorkoutPlanForm";
import { getApi } from "../../../../lib/api";

export default function EditWorkoutPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<WorkoutPlan | null | undefined>(undefined);

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
      <h1 style={{ margin: "0 0 16px", fontSize: 22 }}>Edit workout</h1>
      <WorkoutPlanForm existing={plan} />
    </AppShell>
  );
}
