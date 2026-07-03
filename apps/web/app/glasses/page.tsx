"use client";

// Segment 09 acceptance page: the mock glasses. showCard() renders on the
// virtual lens, capabilities toggle live, gestures and voice results can be
// injected, and every adapter call lands in the event log. No hardware.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GlassesCapabilities, GlassesCard, GlassesGesture } from "@setflow/shared";
import {
  createMockGlassesAdapter,
  type MockGlassesEvent,
} from "@setflow/glasses-adapter";
import AppShell from "../../components/AppShell";
import GlassesCardView from "../../components/GlassesCardView";

const SAMPLE_CARDS: Array<{ label: string; card: GlassesCard }> = [
  {
    label: "Workout start",
    card: { kind: "workout_start", workoutTitle: "Upper Body A", exerciseCount: 3, estimatedMinutes: 52 },
  },
  {
    label: "Exercise preview",
    card: {
      kind: "exercise_preview",
      exerciseName: "Incline Dumbbell Press",
      setCount: 4,
      targetReps: 8,
      restSeconds: 90,
      hasDemo: true,
    },
  },
  {
    label: "Demo",
    card: {
      kind: "demo",
      exerciseName: "Incline Dumbbell Press",
      demoDurationSeconds: 12,
      cue: "Elbows 45 degrees",
      media: { url: "https://example.com/demo.mp4", mediaType: "video", durationSeconds: 12 },
    },
  },
  {
    label: "Active set",
    card: {
      kind: "active_set",
      exerciseName: "Incline Dumbbell Press",
      setNumber: 2,
      setCount: 4,
      targetWeight: 60,
      targetReps: 8,
      unit: "lb",
    },
  },
  { label: "Listening", card: { kind: "listening", examplePhrase: 'Say: "60 for 8"' } },
  {
    label: "Confirmation",
    card: { kind: "confirmation", loggedWeight: 60, loggedReps: 8, unit: "lb", restSeconds: 90 },
  },
  {
    label: "Correction",
    card: {
      kind: "correction",
      options: [
        { weight: 60, reps: 8, unit: "lb" },
        { weight: 68, reps: 8, unit: "lb" },
      ],
    },
  },
  {
    label: "Rest",
    card: {
      kind: "rest",
      remainingSeconds: 72,
      nextLabel: "Set 3",
      exerciseName: "Incline Dumbbell Press",
    },
  },
  {
    label: "Workout complete",
    card: { kind: "workout_complete", durationMinutes: 47, totalSets: 12, message: "Nice work!" },
  },
];

const CAPABILITY_LABELS: Record<keyof GlassesCapabilities, string> = {
  displayCards: "Display cards",
  playShortVideo: "Play short video",
  playAudioCues: "Play audio cues",
  captureMicrophone: "Microphone",
  captureCamera: "Camera",
  gestures: "Gestures",
  offlineMediaCache: "Offline media cache",
};

const GESTURES: GlassesGesture[] = ["tap", "double_tap", "swipe_forward", "swipe_back", "pinch", "long_press"];

export default function GlassesPreviewPage() {
  const adapter = useMemo(() => createMockGlassesAdapter(), []);
  const [card, setCard] = useState<GlassesCard | null>(null);
  const [caps, setCaps] = useState<GlassesCapabilities | null>(null);
  const [log, setLog] = useState<MockGlassesEvent[]>([]);
  const [listening, setListening] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offCard = adapter.onCardChange(setCard);
    const offEvent = adapter.onEvent((e) => setLog((prev) => [...prev.slice(-49), e]));
    adapter.connect();
    adapter.getCapabilities().then(setCaps);
    adapter.onGesture(() => {
      // Registered so gesture wiring is exercised end to end; the log shows them.
    });
    return () => {
      offCard();
      offEvent();
    };
  }, [adapter]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const show = async (c: GlassesCard) => {
    try {
      await adapter.showCard(c);
    } catch {
      // Capability off: the adapter already logged the block.
    }
  };

  const startListening = () => {
    setListening(true);
    adapter
      .startVoiceCapture()
      .then(() => setListening(false))
      .catch(() => setListening(false));
  };

  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>Glasses preview</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
        The mock glasses display - every card the real lens will show, no hardware needed. Black =
        transparent on the actual device.
      </p>

      <div style={{ display: "flex", gap: 20, marginTop: 18, flexWrap: "wrap" }}>
        {/* The lens */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <GlassesCardView card={card} size={320} />
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
              Wearer gestures
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {GESTURES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className="btn"
                  style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 10px", fontSize: 12 }}
                  onClick={() => adapter.emitGesture(g)}
                >
                  {g.replace("_", " ")}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              {listening ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => adapter.injectVoice("60 for 8", 0.93)}
                  >
                    Say "60 for 8"
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 10px", fontSize: 12 }}
                    onClick={() => adapter.stopVoiceCapture()}
                  >
                    Stop capture
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  style={{ background: "var(--panel2)", color: "var(--text)", padding: "6px 10px", fontSize: 12 }}
                  onClick={startListening}
                >
                  🎙 Start voice capture
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Show a card</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SAMPLE_CARDS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="btn"
                  style={{
                    background: card?.kind === s.card.kind ? "var(--accent)" : "var(--panel2)",
                    color: card?.kind === s.card.kind ? "#0d1117" : "var(--text)",
                    padding: "7px 12px",
                    fontSize: 13,
                  }}
                  onClick={() => show(s.card)}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                className="btn"
                style={{ background: "var(--panel2)", color: "var(--muted)", padding: "7px 12px", fontSize: 13 }}
                onClick={() => adapter.disconnect().then(() => adapter.connect())}
              >
                Blank (reconnect)
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Device capabilities
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                {" "}
                - features must degrade when these are off
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {caps &&
                (Object.keys(CAPABILITY_LABELS) as Array<keyof GlassesCapabilities>).map((k) => (
                  <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={caps[k]}
                      onChange={(e) => {
                        adapter.setCapability(k, e.target.checked);
                        setCaps({ ...caps, [k]: e.target.checked });
                      }}
                    />
                    {CAPABILITY_LABELS[k]}
                  </label>
                ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Event log</div>
            <div
              ref={logRef}
              style={{
                maxHeight: 180,
                overflowY: "auto",
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              {log.length === 0 ? (
                <span style={{ color: "var(--muted)" }}>No activity yet.</span>
              ) : (
                log.map((e, i) => (
                  <div key={i} style={{ color: e.kind === "error" ? "#ff7a7a" : "var(--muted)" }}>
                    <span style={{ color: e.kind === "error" ? "#ff7a7a" : "var(--green)" }}>
                      {e.kind}
                    </span>{" "}
                    {e.detail}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
