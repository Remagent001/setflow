import AppShell from "../../components/AppShell";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>Dashboard</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>Weekly summary lands in Segment 16.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginTop: 18 }}>
        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Workouts this week</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>0</div>
        </div>
        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Total sets</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>0</div>
        </div>
        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Total volume</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>0 lb</div>
        </div>
        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Streak</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>0 days</div>
        </div>
      </div>
    </AppShell>
  );
}
