// Session detail (Segment 14): every set from one workout session, grouped
// by exercise, with inline editing for logs that came out wrong.

import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, SetLog, WorkoutJournal, WorkoutSession } from "@setflow/shared";
import { colors, themedStyles } from "../theme";
import { getApi } from "../api";
import { Button, Card, H1, Muted } from "../components/ui";

export default function SessionDetailScreen({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [planTitle, setPlanTitle] = useState("Workout");
  const [logs, setLogs] = useState<SetLog[] | null>(null);
  const [journal, setJournal] = useState<WorkoutJournal | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editReps, setEditReps] = useState("");
  const [busy, setBusy] = useState(false);
  const styles = getStyles();

  const load = useCallback(async () => {
    const api = getApi();
    const s = await api.getSession(sessionId);
    setSession(s);
    if (s) {
      const [plan, setLogList, exs, j] = await Promise.all([
        api.getWorkoutPlan(s.workoutPlanId),
        api.listSetLogs(sessionId),
        api.listExercises(),
        api.getJournal(sessionId),
      ]);
      if (plan) setPlanTitle(plan.title);
      setLogs(setLogList);
      setExercises(new Map(exs.map((e) => [e.id, e])));
      setJournal(j);
    } else {
      setLogs([]);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveEdit = async (log: SetLog) => {
    setBusy(true);
    try {
      const w = Number(editWeight);
      const r = Number(editReps);
      const updated = await getApi().updateSetLog(log.id, {
        actualWeight: editWeight.trim() !== "" && Number.isFinite(w) ? w : undefined,
        actualReps: editReps.trim() !== "" && Number.isFinite(r) ? r : undefined,
        status: "completed",
      });
      setLogs((prev) => prev?.map((l) => (l.id === log.id ? updated : l)) ?? null);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  // Group logs by exercise, preserving order of first appearance.
  const groups: Array<{ exerciseId: string; name: string; logs: SetLog[] }> = [];
  for (const log of logs ?? []) {
    let g = groups.find((x) => x.exerciseId === log.exerciseId);
    if (!g) {
      g = {
        exerciseId: log.exerciseId,
        name: exercises.get(log.exerciseId)?.name ?? "Exercise",
        logs: [],
      };
      groups.push(g);
    }
    g.logs.push(log);
  }

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
    <View style={styles.wrap}>
      <H1>{planTitle}</H1>
      <Muted>
        {session ? new Date(session.createdAt).toLocaleString() : ""}
        {session?.durationSeconds != null
          ? ` · ${Math.max(1, Math.round(session.durationSeconds / 60))} min`
          : ""}
      </Muted>

      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
        {journal && (
          <Card style={{ gap: 4 }}>
            <Text style={styles.exercise}>Journal</Text>
            {journal.energy || journal.sleep || journal.soreness || journal.motivation ? (
              <Muted>
                Before:{" "}
                {[
                  journal.energy && `energy ${journal.energy}`,
                  journal.sleep && `sleep ${journal.sleep}`,
                  journal.soreness && `soreness ${journal.soreness}`,
                  journal.motivation && `motivation ${journal.motivation}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Muted>
            ) : null}
            {journal.preWorkoutMeal ? <Muted>Meal: {journal.preWorkoutMeal}</Muted> : null}
            {journal.overallEffort || journal.moodAfter || journal.pain ? (
              <Muted>
                After:{" "}
                {[
                  journal.overallEffort && `effort ${journal.overallEffort}`,
                  journal.moodAfter && `mood ${journal.moodAfter}`,
                  journal.pain && `pain ${journal.pain}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Muted>
            ) : null}
            {journal.bestLift ? <Muted>Best lift: {journal.bestLift}</Muted> : null}
            {journal.notes ? <Muted>{journal.notes}</Muted> : null}
          </Card>
        )}
        {logs === null ? (
          <Muted>Loading...</Muted>
        ) : groups.length === 0 ? (
          <Card>
            <Muted>No sets were logged in this session.</Muted>
          </Card>
        ) : (
          groups.map((g) => (
            <Card key={g.exerciseId} style={{ gap: 8 }}>
              <Text style={styles.exercise}>{g.name}</Text>
              {g.logs.map((l) => (
                <View key={l.id} style={styles.logRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logText}>
                      Set {l.setNumber}: {describe(l)}
                    </Text>
                    {l.difficulty ? <Muted>felt: {l.difficulty}</Muted> : null}
                    {l.note ? <Muted>{l.note}</Muted> : null}
                  </View>
                  {editingId === l.id ? null : (
                    <Button
                      title="Edit"
                      kind="quiet"
                      onPress={() => {
                        setEditingId(l.id);
                        setEditWeight(l.actualWeight != null ? String(l.actualWeight) : "");
                        setEditReps(l.actualReps != null ? String(l.actualReps) : "");
                      }}
                    />
                  )}
                  {editingId === l.id && (
                    <View style={styles.editBox}>
                      <TextInput
                        style={styles.editInput}
                        value={editWeight}
                        onChangeText={setEditWeight}
                        keyboardType="numeric"
                        placeholder="weight"
                        placeholderTextColor={colors.muted}
                      />
                      <Text style={{ color: colors.muted }}>×</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editReps}
                        onChangeText={setEditReps}
                        keyboardType="numeric"
                        placeholder="reps"
                        placeholderTextColor={colors.muted}
                      />
                      <Button title="Save" disabled={busy} onPress={() => saveEdit(l)} />
                      <Button title="X" kind="quiet" onPress={() => setEditingId(null)} />
                    </View>
                  )}
                </View>
              ))}
            </Card>
          ))
        )}
      </ScrollView>

      <Button title="Back to history" kind="quiet" onPress={onBack} />
    </View>
  );
}

const getStyles = themedStyles(() => StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 10, backgroundColor: colors.bg },
  exercise: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 8,
  },
  logText: { color: colors.text, fontSize: 14 },
  editBox: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  editInput: {
    backgroundColor: colors.panel2,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 15,
    flex: 1,
    textAlign: "center",
  },
}));
