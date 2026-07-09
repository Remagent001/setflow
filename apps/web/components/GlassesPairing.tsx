"use client";

// Settings → Glasses: generate a private link that pairs the Meta glasses to
// this account (they show your live plan and send logged sets back), plus a
// list of paired links with a Remove (revoke) button. Only meaningful with the
// real cloud backend; mock mode shows a short note. Themed via CSS vars so it
// reads correctly in both light and dark.

import { useEffect, useState } from "react";
import { BACKEND } from "../lib/backend";
import { createPairToken, listPairTokens, revokePairToken, type PairToken } from "../lib/glasses";

export default function GlassesPairing() {
  const [tokens, setTokens] = useState<PairToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    if (BACKEND !== "supabase") {
      setLoading(false);
      return;
    }
    listPairTokens()
      .then(setTokens)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your links."))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const generate = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const link = await createPairToken("Glasses");
      setUrl(link);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // clipboard blocked - the field is selectable as a fallback
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await revokePairToken(id);
      setTokens((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that link.");
    } finally {
      setBusy(false);
    }
  };

  const label = (
    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>GLASSES</div>
  );

  if (BACKEND !== "supabase") {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        {label}
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          Connecting glasses needs a real account (cloud backend). It&apos;s available on the live site.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      {label}
      <p style={{ marginTop: 0, fontSize: 13, color: "var(--muted)" }}>
        Connect your Meta glasses so they show <strong>your</strong> workouts and send what you lift back here.
      </p>
      <button className="btn" type="button" onClick={generate} disabled={busy}>
        {busy ? "Working…" : "Connect your glasses"}
      </button>

      {url && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: "var(--panel2)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>Your glasses link.</strong> Copy it, then add it in the Meta AI app on your phone. Keep it
            private — anyone with this link can see and add to your workouts. You can Remove it below anytime.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 220, fontSize: 12 }}
            />
            <button className="btn" type="button" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
            PAIRED LINKS
          </div>
          {tokens.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 13 }}>
                {t.label ?? "Glasses"}
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : "not used yet"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => revoke(t.id)}
                disabled={busy}
                style={{
                  background: "transparent",
                  color: "#ff7a7a",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Loading…</div>}
      {error && <div style={{ color: "#ff7a7a", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
