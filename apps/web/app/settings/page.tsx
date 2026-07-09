"use client";

// Web settings (Segment 20): theme toggle (Keith's ask) + a pointer to the
// phone app, where the full privacy/unit settings live alongside workouts.

import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import GlassesPairing from "../../components/GlassesPairing";

export default function SettingsPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("setflow-theme");
      if (saved === "light") setTheme("light");
    } catch {
      // default dark
    }
  }, []);

  const apply = (next: "dark" | "light") => {
    setTheme(next);
    try {
      window.localStorage.setItem("setflow-theme", next);
    } catch {
      // still applies for this page view
    }
    document.body.classList.toggle("light", next === "light");
  };

  const chip = (value: "dark" | "light", label: string) => (
    <button
      type="button"
      className="btn"
      onClick={() => apply(value)}
      style={{
        background: theme === value ? "var(--accent)" : "var(--panel2)",
        color: theme === value ? "var(--bg)" : "var(--text)",
        padding: "8px 18px",
      }}
    >
      {label}
    </button>
  );

  return (
    <AppShell>
      <h1 style={{ margin: 0, fontSize: 22 }}>Settings</h1>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>
          APPEARANCE
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {chip("dark", "Dark")}
          {chip("light", "Light")}
        </div>
      </div>

      <GlassesPairing />

      <div className="card" style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
        Weight units, voice logging, and privacy settings live in the phone app&apos;s Settings
        tab - that&apos;s where workouts are logged. Web settings expand when accounts arrive.
      </div>
    </AppShell>
  );
}
