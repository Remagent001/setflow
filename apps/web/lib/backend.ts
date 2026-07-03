// Backend switch: "mock" (browser-local, the default) or "supabase" (real
// accounts + cloud sync). Set NEXT_PUBLIC_BACKEND=supabase plus the
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars
// (apps/web/.env.local) to go live; without them the app stays fully
// functional in mock mode.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const BACKEND: "mock" | "supabase" =
  process.env.NEXT_PUBLIC_BACKEND === "supabase" && url && anonKey ? "supabase" : "mock";

let sb: SupabaseClient | null = null;

/** The shared Supabase client (auth session persists in localStorage). */
export function getSupabase(): SupabaseClient {
  if (!sb) {
    if (BACKEND !== "supabase") throw new Error("Supabase backend is not enabled");
    sb = createClient(url!, anonKey!);
  }
  return sb;
}
