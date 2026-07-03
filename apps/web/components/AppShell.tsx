"use client";

// Signed-in app frame: sidebar nav + top bar + content area. Client-side
// mock-auth guard redirects to /login when signed out.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getUser, signOut, type MockUser } from "../lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/workouts", label: "Workouts", icon: "▤" },
  { href: "/exercises", label: "Exercises", icon: "⚙" },
  { href: "/glasses", label: "Glasses", icon: "◎" },
  { href: "/history", label: "History", icon: "◷" },
  { href: "/reports", label: "Reports", icon: "▲" },
  { href: "/settings", label: "Settings", icon: "☰" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<MockUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setUser(u);
    setChecked(true);
  }, [router]);

  // Apply the saved theme on every page (the toggle lives in Settings).
  useEffect(() => {
    try {
      const theme = window.localStorage.getItem("setflow-theme");
      document.body.classList.toggle("light", theme === "light");
    } catch {
      // default dark
    }
  }, []);

  if (!checked) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 210,
          flexShrink: 0,
          background: "var(--panel)",
          borderRight: "1px solid var(--border)",
          padding: "18px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ padding: "0 10px 14px", fontWeight: 700, fontSize: 18 }}>
          SetFlow
        </div>
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 8,
                background: active ? "var(--panel2)" : "transparent",
                color: active ? "var(--text)" : "var(--muted)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 14,
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel)",
          }}
        >
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{user?.email}</span>
          <button
            className="btn"
            style={{ background: "var(--panel2)", color: "var(--text)", padding: "7px 14px" }}
            onClick={() => {
              signOut();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </header>
        <main style={{ padding: 24, maxWidth: 1000 }}>{children}</main>
      </div>
    </div>
  );
}
