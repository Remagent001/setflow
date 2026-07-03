// React Native twin of the web's GlassesCardView: renders the SAME
// GlassesCard data the mock glasses show, so mobile and lens always agree
// (Segment 10 acceptance: "mobile app can render the same card data as
// mock glasses").

import { StyleSheet, Text, View } from "react-native";
import type { GlassesCard } from "@setflow/shared";
import { colors } from "../theme";

const mmss = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

function CardBody({ card }: { card: GlassesCard }) {
  switch (card.kind) {
    case "workout_start":
      return (
        <>
          <Text style={styles.dim}>READY</Text>
          <Text style={styles.big}>{card.workoutTitle}</Text>
          <Text style={styles.mid}>
            {card.exerciseCount} exercise{card.exerciseCount === 1 ? "" : "s"}
            {card.estimatedMinutes ? ` · ~${card.estimatedMinutes} min` : ""}
          </Text>
        </>
      );
    case "exercise_preview":
      return (
        <>
          <Text style={styles.dim}>NEXT UP</Text>
          <Text style={styles.big}>{card.exerciseName}</Text>
          <Text style={styles.mid}>
            {card.setCount} sets{card.targetReps ? ` × ${card.targetReps}` : ""} · rest{" "}
            {card.restSeconds}s
          </Text>
          {card.hasDemo && <Text style={styles.dim}>Demo available</Text>}
        </>
      );
    case "demo":
      return (
        <>
          <Text style={styles.dim}>DEMO</Text>
          <Text style={styles.mid}>{card.exerciseName}</Text>
          <View style={styles.demoBox}>
            <Text style={styles.mid}>{card.media ? "▶" : "no clip"}</Text>
          </View>
          {card.cue ? <Text style={styles.dim}>{card.cue}</Text> : null}
        </>
      );
    case "active_set":
      return (
        <>
          <Text style={styles.mid}>{card.exerciseName}</Text>
          <Text style={styles.dim}>
            SET {card.setNumber} / {card.setCount}
          </Text>
          {card.remainingSeconds != null && (
            <Text style={styles.huge}>{mmss(card.remainingSeconds)}</Text>
          )}
          <Text style={styles.big}>
            {card.targetWeight != null ? `${card.targetWeight} ${card.unit}` : ""}
            {card.targetWeight != null && card.targetReps != null ? " × " : ""}
            {card.targetReps != null ? `${card.targetReps}` : ""}
            {card.targetDurationSeconds != null ? ` ${card.targetDurationSeconds}s` : ""}
          </Text>
        </>
      );
    case "listening":
      return (
        <>
          <Text style={styles.big}>🎙</Text>
          <Text style={styles.mid}>Listening...</Text>
          <Text style={styles.dim}>{card.examplePhrase}</Text>
        </>
      );
    case "confirmation":
      return (
        <>
          <Text style={styles.dim}>LOGGED</Text>
          <Text style={styles.big}>
            {card.loggedWeight != null ? `${card.loggedWeight} ${card.unit}` : ""}
            {card.loggedWeight != null && card.loggedReps != null ? " × " : ""}
            {card.loggedReps != null ? `${card.loggedReps}` : ""}
          </Text>
          <Text style={styles.dim}>Rest {card.restSeconds}s starts now</Text>
        </>
      );
    case "correction":
      return (
        <>
          <Text style={styles.dim}>WHICH ONE?</Text>
          {card.options.map((o, i) => (
            <Text key={i} style={styles.mid}>
              {i + 1}. {o.weight != null ? `${o.weight} ${o.unit}` : ""}
              {o.weight != null && o.reps != null ? " × " : ""}
              {o.reps != null ? o.reps : ""}
            </Text>
          ))}
        </>
      );
    case "rest":
      return (
        <>
          {card.exerciseName ? <Text style={styles.mid}>{card.exerciseName}</Text> : null}
          <Text style={styles.dim}>REST</Text>
          <Text style={styles.huge}>{mmss(card.remainingSeconds)}</Text>
          <Text style={styles.mid}>Next: {card.nextLabel}</Text>
        </>
      );
    case "workout_complete":
      return (
        <>
          <Text style={styles.big}>✔ Done</Text>
          <Text style={styles.mid}>
            {card.totalSets} sets · {card.durationMinutes} min
          </Text>
          {card.message ? <Text style={styles.dim}>{card.message}</Text> : null}
        </>
      );
  }
}

export default function GlassesCardRN({ card }: { card: GlassesCard | null }) {
  return (
    <View style={styles.lens}>
      {card ? <CardBody card={card} /> : <Text style={styles.blank}>display off / blank</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  lens: {
    aspectRatio: 1,
    width: "100%",
    maxWidth: 340,
    alignSelf: "center",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  big: { color: colors.lensText, fontSize: 32, fontWeight: "800", textAlign: "center" },
  huge: { color: colors.lensText, fontSize: 56, fontWeight: "800", textAlign: "center" },
  mid: { color: colors.lensText, fontSize: 20, fontWeight: "600", textAlign: "center" },
  dim: { color: colors.lensDim, fontSize: 15, opacity: 0.85, textAlign: "center" },
  blank: { color: "#3a4a55", fontSize: 15 },
  demoBox: {
    width: "70%",
    aspectRatio: 16 / 9,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.lensDim,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
