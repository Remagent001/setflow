"use client";

// Workout history (Segment 14): completed sessions with their set logs.
// Sessions are logged from the mobile player; this page reads the same
// data model. Set-log editing lives on mobile; web gets full reporting
// in Segment 16.

import { useEffect, useState } from "react";
import type { Exercise, SetLog, WorkoutSession } from "@setflow/shared";
import AppShell from "../../components/AppShell";
import { getApi } from "../../lib/api";

const MOCK_USER_ID = "mock-user";

type Row = WorkoutSession & { planTitle: string; logs: SetLog[] };

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const api = getApi();
    Promise.all([api.listSessions(MOCK_USER_ID), api.listExercises()]).then(
      async ([sessions, exs]) => {
        setExercises(new Map(exs.map((e) => [e.id, e])));
        const withDetail = await Promise.all(
          sessions.map(async (s) => {
            const [plan, logs] = await Promise.all([
              api.getWorkoutPlan(s.workoutPlanId),
              api.listSetLogs(s.id),
            ]);
            return { ...s, planTitle: plan?.title ?? "Workout", logs };
          })
        );
        setRows(withDetail);
      }
    );
  }, []);

  const describe = (l: SetLog) => {
    if (l.status === "skipped") return "skipped";
    const parts: string[] = [];
    if (l.actualWeight != null) parts.push(`${l.actualWeight} ${l.unit === "kg" ? "kg" : "lb"}`);
    if (l.unit === "bodyweight") parts.push("bodyweight");
    if (l.actualReps != null) parts.push(`× ${l.actualReps}`);
    if (l.status === "failed") parts.push("(failed)");
    return parts.join(" ") || "logged";
  };

  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>History</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
        Completed workout sessions. Log workouts from the mobile player; edit any set from the
        session view on your phone.
      </p>

      {rows === null ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>
          No sessions yet - run a workout in the mobile app and it lands here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
          {rows.map((s) => (
            <div key={s.id} className="card">
              <button
                type="button"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text)",
                  padding: 0,
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ fontWeight: 600 }}>{s.planTitle}</span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {new Date(s.createdAt).toLocaleString()} · {s.status}
                  {s.durationSeconds != null
                    ? ` · ${Math.max(1, Math.round(s.durationSeconds / 60))} min`
                    : ""}{" "}
                  · {s.logs.length} set{s.logs.length === 1 ? "" : "s"} {openId === s.id ? "▾" : "▸"}
                </span>
              </button>
              {openId === s.id && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  {s.logs.length === 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>No sets logged.</span>
                  ) : (
                    s.logs.map((l) => (
                      <div key={l.id} style={{ fontSize: 14 }}>
                        <span style={{ color: "var(--accent)" }}>
                          {exercises.get(l.exerciseId)?.name ?? "Exercise"}
                        </span>{" "}
                        - set {l.setNumber}: {describe(l)}
                        {l.difficulty ? (
                          <span style={{ color: "var(--muted)" }}> · felt {l.difficulty}</span>
                        ) : null}
                        {l.note ? <span style={{ color: "var(--muted)" }}> · {l.note}</span> : null}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
