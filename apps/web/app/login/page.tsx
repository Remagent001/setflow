"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");

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
          if (!email.trim()) return;
          signIn(email.trim());
          router.push("/dashboard");
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
        <button className="btn" type="submit">
          Sign in
        </button>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
          Dev preview: any email works (mock auth until Segment 5).
        </p>
      </form>
    </main>
  );
}
