"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BACKEND, signIn, signInWithPassword, signUpWithPassword } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async (mode: "in" | "up") => {
    if (!email.trim()) return;
    if (BACKEND === "mock") {
      signIn(email.trim());
      router.push("/dashboard");
      return;
    }
    if (!password) {
      setNotice("Enter your password.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      if (mode === "in") {
        await signInWithPassword(email.trim(), password);
        router.push("/dashboard");
      } else {
        const result = await signUpWithPassword(email.trim(), password);
        if (result === "confirm_email") {
          setNotice("Check your email for the confirmation link, then sign in.");
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        className="card"
        style={{ width: 360, display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit("in");
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>SetFlow</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Hands-free workouts for smart glasses
          </p>
        </div>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        {BACKEND === "supabase" && (
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        {BACKEND === "supabase" ? (
          <button
            className="btn"
            type="button"
            disabled={busy}
            style={{ background: "var(--panel2)", color: "var(--text)" }}
            onClick={() => submit("up")}
          >
            Create account
          </button>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Dev preview: any email works (mock auth).
          </p>
        )}
        {notice && <p style={{ margin: 0, color: "#ff7a7a", fontSize: 13 }}>{notice}</p>}
      </form>
    </main>
  );
}
