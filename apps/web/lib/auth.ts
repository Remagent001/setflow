// Auth for the web app. Mock mode keeps the original any-email localStorage
// flow; supabase mode signs in with email + password and mirrors the email
// locally so the (synchronous) shell check stays unchanged. The API's data
// calls carry the real JWT either way - this mirror is display-only.
"use client";

import { ensureStarterData } from "@setflow/api-client";
import { BACKEND, getSupabase } from "./backend";
import { getApi } from "./api";

export type MockUser = { email: string; displayName: string };

const KEY = "setflow-mock-user";

export function getUser(): MockUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

function mirror(email: string): MockUser {
  const user: MockUser = { email, displayName: email.split("@")[0] ?? email };
  window.localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

/** Mock mode: any email. Supabase mode: use signInWithPassword instead. */
export function signIn(email: string): MockUser {
  return mirror(email);
}

/** Supabase sign-in (and first-login starter seeding). Throws with a readable message. */
export async function signInWithPassword(email: string, password: string): Promise<MockUser> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const user = mirror(data.user?.email ?? email);
  try {
    await ensureStarterData(getApi(), data.user?.id ?? "");
  } catch {
    // Seeding is best-effort; an empty library is still usable.
  }
  return user;
}

/** Supabase account creation. May require email confirmation depending on project settings. */
export async function signUpWithPassword(email: string, password: string): Promise<"ok" | "confirm_email"> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) return "confirm_email"; // project requires the email link
  mirror(email);
  try {
    await ensureStarterData(getApi(), data.user?.id ?? "");
  } catch {
    // best-effort
  }
  return "ok";
}

export function signOut(): void {
  window.localStorage.removeItem(KEY);
  if (BACKEND === "supabase") {
    getSupabase().auth.signOut().catch(() => {});
  }
}

export { BACKEND };
