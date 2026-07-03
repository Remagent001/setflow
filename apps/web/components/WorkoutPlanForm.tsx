"use client";

// Create/edit form for a workout plan's metadata (title, description,
// difficulty, estimated duration). Steps are managed on the plan's page.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorkoutPlan } from "@setflow/shared";
import { getApi } from "../lib/api";

const DIFFICULTIES = ["", "beginner", "intermediate", "advanced"] as const;
const MOCK_USER_ID = "mock-user";

export default function WorkoutPlanForm({ existing }: { existing?: WorkoutPlan }) {
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [difficulty, setDifficulty] = useState<string>(existing?.difficulty ?? "");
  const [duration, setDuration] = useState(
    existing?.estimatedDurationMinutes != null ? String(existing.estimatedDurationMinutes) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const field = (label: string, control: React.ReactNode, hint?: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {control}
      {hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );

  return (
    <form
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) {
          setError("Title is required.");
          return;
        }
        const minutes = duration.trim() === "" ? undefined : Number(duration);
        if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)) {
          setError("Estimated duration must be a positive number of minutes.");
          return;
        }
        setSaving(true);
        setError("");
        try {
          const api = getApi();
          const input = {
            ownerUserId: existing?.ownerUserId ?? MOCK_USER_ID,
            title: title.trim(),
            description: description.trim() || undefined,
            difficulty: (difficulty || undefined) as WorkoutPlan["difficulty"],
            estimatedDurationMinutes: minutes,
          };
          const saved = existing
            ? await api.updateWorkoutPlan(existing.id, input)
            : await api.createWorkoutPlan(input);
          router.push(`/workouts/${saved.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed.");
          setSaving(false);
        }
      }}
    >
      {field(
        "Title *",
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      )}
      {field(
        "Description",
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      )}
      {field(
        "Difficulty",
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d === "" ? "Not set" : d.charAt(0).toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
      )}
      {field(
        "Estimated duration (minutes)",
        <input
          type="number"
          min={1}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />,
        "Optional - rough total time for the whole workout"
      )}

      {error && <div style={{ color: "#ff7a7a", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : existing ? "Save changes" : "Create workout"}
        </button>
        <button
          type="button"
          className="btn"
          style={{ background: "var(--panel2)", color: "var(--text)" }}
          onClick={() => router.back()}
        >
          Cancel
        </button>
      </div>
      {!existing && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          You'll add exercises on the next screen.
        </div>
      )}
    </form>
  );
}
