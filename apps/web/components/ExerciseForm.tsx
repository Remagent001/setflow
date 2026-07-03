"use client";

// Create/edit form for exercises. List-ish fields (cues, mistakes,
// secondary muscles, equipment) are entered one per line / comma-separated
// and stored as arrays.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Exercise } from "@setflow/shared";
import { getApi } from "../lib/api";

const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Legs",
  "Arms",
  "Core",
  "Full Body",
  "Other",
];

const splitLines = (t: string) =>
  t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const splitCommas = (t: string) =>
  t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export default function ExerciseForm({ existing }: { existing?: Exercise }) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [muscle, setMuscle] = useState(existing?.primaryMuscleGroup ?? "Chest");
  const [secondary, setSecondary] = useState(existing?.secondaryMuscleGroups?.join(", ") ?? "");
  const [equipment, setEquipment] = useState(existing?.equipment?.join(", ") ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [cues, setCues] = useState(existing?.cues?.join("\n") ?? "");
  const [mistakes, setMistakes] = useState(existing?.commonMistakes?.join("\n") ?? "");
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
        if (!name.trim()) {
          setError("Name is required.");
          return;
        }
        setSaving(true);
        setError("");
        try {
          const api = getApi();
          const input = {
            name: name.trim(),
            description: description.trim() || undefined,
            primaryMuscleGroup: muscle,
            secondaryMuscleGroups: splitCommas(secondary),
            equipment: splitCommas(equipment),
            instructions: instructions.trim() || undefined,
            cues: splitLines(cues),
            commonMistakes: splitLines(mistakes),
          };
          const saved = existing
            ? await api.updateExercise(existing.id, input)
            : await api.createExercise(input);
          router.push(`/exercises/${saved.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed.");
          setSaving(false);
        }
      }}
    >
      {field(
        "Name *",
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      )}
      {field(
        "Description",
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      )}
      {field(
        "Primary muscle group",
        <select value={muscle} onChange={(e) => setMuscle(e.target.value)}>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      )}
      {field(
        "Secondary muscle groups",
        <input value={secondary} onChange={(e) => setSecondary(e.target.value)} />,
        "Comma-separated, e.g. Triceps, Shoulders"
      )}
      {field(
        "Equipment",
        <input value={equipment} onChange={(e) => setEquipment(e.target.value)} />,
        "Comma-separated, e.g. dumbbells, bench"
      )}
      {field(
        "Instructions",
        <textarea
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      )}
      {field(
        "Cues",
        <textarea rows={3} value={cues} onChange={(e) => setCues(e.target.value)} />,
        "One per line - shown on the glasses demo card, keep them short"
      )}
      {field(
        "Common mistakes",
        <textarea rows={3} value={mistakes} onChange={(e) => setMistakes(e.target.value)} />,
        "One per line"
      )}

      <div className="card" style={{ background: "var(--panel2)", padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Demo video</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {existing
            ? "Manage the demo video from this exercise's page after saving."
            : "Create the exercise first, then add a demo video from its page."}
        </div>
      </div>

      {error && <div style={{ color: "#ff7a7a", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : existing ? "Save changes" : "Create exercise"}
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
    </form>
  );
}
