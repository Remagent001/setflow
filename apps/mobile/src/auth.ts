// Phone auth (supabase mode). Mock mode needs none of this - any email
// signs in locally, exactly as before.

import { ensureStarterData } from "@setflow/api-client";
import { BACKEND, getSupabase } from "./backend";
import { getApi } from "./api";

export { BACKEND };

/** Restore a persisted session at launch; returns the signed-in email. */
export async function restoreSession(): Promise<string | null> {
  if (BACKEND !== "supabase") return null;
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

export async function signInSupabase(email: string, password: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  try {
    await ensureStarterData(getApi(), data.user?.id ?? "");
  } catch {
    // best-effort; an empty library is still usable
  }
  return data.user?.email ?? email;
}

export async function signOutSupabase(): Promise<void> {
  if (BACKEND !== "supabase") return;
  try {
    await getSupabase().auth.signOut();
  } catch {
    // local session is cleared regardless
  }
}
