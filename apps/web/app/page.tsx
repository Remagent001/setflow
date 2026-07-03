import type { GlassesCard } from "@setflow/shared";

// Proves the shared-types import path works end-to-end (Segment 01
// acceptance criterion); the real UI replaces this in Segment 4+.
const sampleCard = {
  kind: "workout_start",
  workoutTitle: "Upper Body A",
  exerciseCount: 7,
  estimatedMinutes: 52,
} satisfies GlassesCard;

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        background: "#0d1117",
        color: "#e6edf3",
      }}
    >
      <h1 style={{ margin: 0 }}>SetFlow</h1>
      <p style={{ margin: 0, color: "#8b98a9" }}>
        Hands-free workout player for smart glasses. Segment 01 placeholder.
      </p>
      <p style={{ margin: 0, color: "#57d9a3", fontSize: "0.85rem" }}>
        Shared types wired: {sampleCard.workoutTitle} · {sampleCard.exerciseCount} exercises
      </p>
    </main>
  );
}
