"use client";

// Reports dashboard (Segment 16): weekly summary, workout history table,
// per-exercise progress (last vs best), muscle-group volume, and a careful
// journal-insights placeholder. Everything is computed from saved set logs.

import { useEffect, useState } from "react";
import type { Exercise, SetLog, WorkoutSession } from "@setflow/shared";
import type { DashboardSummary } from "@setflow/api-client";
import AppShell from "../../components/AppShell";
import { getApi } from "../../lib/api";

const MOCK_USER_ID = "mock-user";

type SessionRow = WorkoutSession & { planTitle: string; logs: SetLog[] };

const volumeOf = (logs: SetLog[]) =>
  logs.reduce(
    (sum, l) =>
      l.status === "skipped" ? sum : sum + (l.actualWeight ?? 0) * (l.actualReps ?? 0),
    0
  );

const fmt = (n: number) => n.toLocaleString("en-US");

export default function ReportsPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());

  useEffect(() => {
    const api = getApi();
    Promise.all([
      api.getDashboardSummary(MOCK_USER_ID),
      api.listSessions(MOCK_USER_ID),
      api.listExercises(),
    ]).then(async ([sum, sess, exs]) => {
      setSummary(sum);
      setExercises(new Map(exs.map((e) => [e.id, e])));
      const rows = await Promise.all(
        sess.map(async (s) => {
          const [plan, logs] = await Promise.all([
            api.getWorkoutPlan(s.workoutPlanId),
            api.listSetLogs(s.id),
          ]);
          return { ...s, planTitle: plan?.title ?? "Workout", logs };
        })
      );
      setSessions(rows);
    });
  }, []);

  const allLogs = (sessions ?? []).flatMap((s) =>
    s.logs.map((l) => ({ ...l, sessionDate: s.createdAt }))
  );
  const lifted = allLogs.filter((l) => l.status !== "skipped");

  // Per-exercise progress: last and best performance.
  const byExercise = new Map<string, Array<SetLog & { sessionDate: string }>>();
  for (const l of lifted) {
    const list = byExercise.get(l.exerciseId) ?? [];
    list.push(l);
    byExercise.set(l.exerciseId, list);
  }
  const progress = [...byExercise.entries()].map(([exerciseId, logs]) => {
    const sorted = [...logs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const last = sorted[sorted.length - 1];
    const best = [...logs].sort(
      (a, b) =>
        (b.actualWeight ?? 0) - (a.actualWeight ?? 0) ||
        (b.actualReps ?? 0) - (a.actualReps ?? 0)
    )[0];
    return {
      exerciseId,
      name: exercises.get(exerciseId)?.name ?? "Exercise",
      muscle: exercises.get(exerciseId)?.primaryMuscleGroup ?? "Other",
      sets: logs.length,
      last,
      best,
    };
  });

  // Muscle-group volume with CSS bars.
  const muscleVolume = new Map<string, number>();
  for (const l of lifted) {
    const muscle = exercises.get(l.exerciseId)?.primaryMuscleGroup ?? "Other";
    muscleVolume.set(
      muscle,
      (muscleVolume.get(muscle) ?? 0) + (l.actualWeight ?? 0) * (l.actualReps ?? 0)
    );
  }
  const muscleRows = [...muscleVolume.entries()].sort((a, b) => b[1] - a[1]);
  const maxMuscle = muscleRows[0]?.[1] ?? 1;

  const describeSet = (l?: SetLog) =>
    l
      ? `${l.actualWeight != null ? `${l.actualWeight} lb` : l.unit === "bodyweight" ? "bodyweight" : "—"}${
          l.actualReps != null ? ` × ${l.actualReps}` : ""
        }`
      : "—";

  const stat = (label: string, value: string) => (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>Reports</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
        Computed from your saved set logs. Log workouts on the phone and the numbers move.
      </p>

      {/* Weekly summary */}
      <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        {stat("Workouts this week", summary ? String(summary.workoutsThisWeek) : "…")}
        {stat("Sets this week", summary ? String(summary.totalSets) : "…")}
        {stat("Volume this week", summary ? `${fmt(summary.totalVolume)} lb` : "…")}
        {stat("Avg duration", summary ? `${summary.averageDurationMinutes} min` : "…")}
        {stat("Streak", summary ? `${summary.currentStreakDays} day${summary.currentStreakDays === 1 ? "" : "s"}` : "…")}
      </div>

      {/* Exercise progress */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Exercise progress</h2>
        {progress.length === 0 ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            No logged sets yet - finish a workout and your lifts show up here.
          </span>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 12px 6px 0" }}>Exercise</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Sets</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Last</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Best</th>
                </tr>
              </thead>
              <tbody>
                {progress.map((p) => (
                  <tr key={p.exerciseId} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px 8px 0", fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: "8px 12px 8px 0" }}>{p.sets}</td>
                    <td style={{ padding: "8px 12px 8px 0" }}>{describeSet(p.last)}</td>
                    <td style={{ padding: "8px 12px 8px 0", color: "var(--green)" }}>
                      {describeSet(p.best)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Muscle group volume */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Volume by muscle group</h2>
        {muscleRows.length === 0 ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Nothing lifted yet.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {muscleRows.map(([muscle, vol]) => (
              <div key={muscle} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 90, fontSize: 13 }}>{muscle}</div>
                <div style={{ flex: 1, background: "var(--panel2)", borderRadius: 4, height: 18 }}>
                  <div
                    style={{
                      width: `${Math.max(4, Math.round((vol / maxMuscle) * 100))}%`,
                      background: "var(--accent)",
                      height: "100%",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div style={{ width: 90, fontSize: 13, color: "var(--muted)", textAlign: "right" }}>
                  {fmt(vol)} lb
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workout history table */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Workout history</h2>
        {sessions === null ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</span>
        ) : sessions.length === 0 ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>No sessions yet.</span>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 12px 6px 0" }}>Date</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Workout</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Status</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Duration</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Sets</th>
                  <th style={{ padding: "6px 12px 6px 0" }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px 8px 0" }}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "8px 12px 8px 0", fontWeight: 600 }}>{s.planTitle}</td>
                    <td style={{ padding: "8px 12px 8px 0" }}>{s.status}</td>
                    <td style={{ padding: "8px 12px 8px 0" }}>
                      {s.durationSeconds != null
                        ? `${Math.max(1, Math.round(s.durationSeconds / 60))} min`
                        : "—"}
                    </td>
                    <td style={{ padding: "8px 12px 8px 0" }}>{s.logs.length}</td>
                    <td style={{ padding: "8px 12px 8px 0" }}>{fmt(volumeOf(s.logs))} lb</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Journal insights placeholder - careful not to over-claim causality */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Journal insights</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Coming soon: once you&apos;ve logged more sessions with check-ins, this will surface
          patterns - like how your logged sleep or energy lines up with your training volume.
          These will be shown as correlations in your own data, not causes, and never as health
          advice.
        </p>
      </div>
    </AppShell>
  );
}
