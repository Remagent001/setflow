"use client";

// Glasses pairing: create / list / revoke device tokens. The raw token is
// generated in the browser, shown to the user exactly once (baked into the
// glasses URL), and only its SHA-256 hash is stored - matching how the
// glasses_get_plan / glasses_sync_session functions hash the token server-side
// (encode(digest(token,'sha256'),'hex')). All table access is RLS-scoped to
// the signed-in user.

import { getSupabase } from "./backend";

const PREFIX = "sfg_";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lowercase hex SHA-256, matching Postgres encode(digest(...),'hex'). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PairToken = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Mint a token, store only its hash, and return the full glasses URL once. */
export async function createPairToken(label: string): Promise<string> {
  const sb = getSupabase();
  const { data: userData, error: uErr } = await sb.auth.getUser();
  if (uErr || !userData.user) throw new Error("You're not signed in.");

  const raw = PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(raw);

  const { error } = await sb.from("glasses_pair_tokens").insert({
    user_id: userData.user.id,
    token_hash: tokenHash,
    label: label || null,
  });
  if (error) throw new Error(error.message);

  // No trailing slash: /glasses-app/ 308-redirects (stripping the slash) and
  // breaks the app's relative asset base, so hand out the slash-less form.
  return `${window.location.origin}/glasses-app?t=${raw}`;
}

export async function listPairTokens(): Promise<PairToken[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("glasses_pair_tokens")
    .select("id, label, created_at, last_used_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: (r.label as string) ?? null,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string) ?? null,
  }));
}

export async function revokePairToken(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("glasses_pair_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
