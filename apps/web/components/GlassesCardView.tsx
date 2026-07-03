"use client";

// Renders one GlassesCard the way the real lens would: 600x600 logical
// square, black background (black = transparent on the actual display),
// bright text, no scrolling. Shown here at half scale (300px).

import type { GlassesCard } from "@setflow/shared";

const mmss = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

function CardBody({ card }: { card: GlassesCard }) {
  const big: React.CSSProperties = { fontSize: 44, fontWeight: 800, lineHeight: 1.1 };
  const mid: React.CSSProperties = { fontSize: 24, fontWeight: 600 };
  const dim: React.CSSProperties = { fontSize: 18, color: "#9adfff", opacity: 0.85 };

  switch (card.kind) {
    case "workout_start":
      return (
        <>
          <div style={dim}>READY</div>
          <div style={big}>{card.workoutTitle}</div>
          <div style={mid}>
            {card.exerciseCount} exercise{card.exerciseCount === 1 ? "" : "s"}
            {card.estimatedMinutes ? ` · ~${card.estimatedMinutes} min` : ""}
          </div>
          <div style={dim}>Pinch to begin</div>
        </>
      );
    case "exercise_preview":
      return (
        <>
          <div style={dim}>NEXT UP</div>
          <div style={big}>{card.exerciseName}</div>
          <div style={mid}>
            {card.setCount} sets{card.targetReps ? ` × ${card.targetReps}` : ""} · rest{" "}
            {card.restSeconds}s
          </div>
          {card.hasDemo && <div style={dim}>Swipe up for demo</div>}
        </>
      );
    case "demo":
      return (
        <>
          <div style={dim}>DEMO</div>
          <div style={mid}>{card.exerciseName}</div>
          <div
            style={{
              width: "70%",
              aspectRatio: "16 / 9",
              border: "2px dashed #9adfff",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
            }}
          >
            {card.media ? "▶" : "no clip"}
          </div>
          {card.cue && <div style={dim}>{card.cue}</div>}
        </>
      );
    case "active_set":
      return (
        <>
          <div style={dim}>
            SET {card.setNumber} / {card.setCount}
          </div>
          <div style={big}>
            {card.targetWeight != null ? `${card.targetWeight} ${card.unit}` : ""}
            {card.targetWeight != null && card.targetReps != null ? " × " : ""}
            {card.targetReps != null ? `${card.targetReps}` : ""}
            {card.targetDurationSeconds != null ? ` ${card.targetDurationSeconds}s` : ""}
          </div>
          <div style={dim}>Pinch when done</div>
        </>
      );
    case "listening":
      return (
        <>
          <div style={{ fontSize: 52 }}>🎙</div>
          <div style={mid}>Listening...</div>
          <div style={dim}>{card.examplePhrase}</div>
        </>
      );
    case "confirmation":
      return (
        <>
          <div style={dim}>LOGGED</div>
          <div style={big}>
            {card.loggedWeight != null ? `${card.loggedWeight} ${card.unit}` : ""}
            {card.loggedWeight != null && card.loggedReps != null ? " × " : ""}
            {card.loggedReps != null ? `${card.loggedReps}` : ""}
          </div>
          <div style={dim}>Rest {card.restSeconds}s starts now</div>
        </>
      );
    case "correction":
      return (
        <>
          <div style={dim}>WHICH ONE?</div>
          {card.options.map((o, i) => (
            <div key={i} style={mid}>
              {i + 1}. {o.weight != null ? `${o.weight} ${o.unit}` : ""}
              {o.weight != null && o.reps != null ? " × " : ""}
              {o.reps != null ? o.reps : ""}
            </div>
          ))}
        </>
      );
    case "rest":
      return (
        <>
          <div style={dim}>REST</div>
          <div style={{ ...big, fontSize: 64 }}>{mmss(card.remainingSeconds)}</div>
          <div style={mid}>Next: {card.nextLabel}</div>
        </>
      );
    case "workout_complete":
      return (
        <>
          <div style={{ fontSize: 48 }}>✔</div>
          <div style={big}>Done</div>
          <div style={mid}>
            {card.totalSets} sets · {card.durationMinutes} min
          </div>
          {card.message && <div style={dim}>{card.message}</div>}
        </>
      );
  }
}

export default function GlassesCardView({
  card,
  size = 300,
}: {
  card: GlassesCard | null;
  size?: number;
}) {
  return (
    <div
      aria-label="Virtual glasses display"
      style={{
        width: size,
        height: size,
        background: "#000",
        border: "1px solid var(--border)",
        borderRadius: 18,
        color: "#eaffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        textAlign: "center",
        padding: 24,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {card ? (
        <CardBody card={card} />
      ) : (
        <div style={{ color: "#3a4a55", fontSize: 16 }}>display off / blank</div>
      )}
    </div>
  );
}
