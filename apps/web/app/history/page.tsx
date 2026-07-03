import AppShell from "../../components/AppShell";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>History</h1>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>Completed sessions appear here from Segment 14.</p>
      <div className="card" style={{ marginTop: 18, color: "var(--muted)" }}>
        Nothing here yet.
      </div>
    </AppShell>
  );
}
