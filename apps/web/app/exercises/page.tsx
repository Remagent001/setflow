import AppShell from "../../components/AppShell";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>Exercises</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>The exercise library lands in Segment 5.</p>
      <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>
        Nothing here yet.
      </div>
    </AppShell>
  );
}
