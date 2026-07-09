"use client";

// Signed-in app frame: sidebar nav + top bar + content area. Client-side
// mock-auth guard redirects to /login when signed out. The sidebar is a static
// left panel on desktop and a slide-in drawer (hamburger) on mobile.

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
  const [navOpen, setNavOpen] = useState(false);

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

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!checked) return null;

  return (
    <div className="shell">
      <div
        className={`sidebar-backdrop${navOpen ? " open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden
      />
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="sidebar-brand">SetFlow</div>
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${active ? " active" : ""}`}
              onClick={() => setNavOpen(false)}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </aside>

      <div className="content">
        <header className="topbar">
          <button
            type="button"
            className="hamburger"
            aria-label="Menu"
            onClick={() => setNavOpen((o) => !o)}
          >
            ☰
          </button>
          <span className="topbar-brand">SetFlow</span>
          <div className="topbar-spacer" />
          <span className="topbar-email">{user?.email}</span>
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
        <main className="page-main">{children}</main>
      </div>
    </div>
  );
}
