// Backend switch for the phone app: "mock" (offline, AsyncStorage - the
// default) or "supabase" (real account + cloud sync). Set
// EXPO_PUBLIC_BACKEND=supabase plus EXPO_PUBLIC_SUPABASE_URL /
// EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env to go live.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const BACKEND: "mock" | "supabase" =
  process.env.EXPO_PUBLIC_BACKEND === "supabase" && url && anonKey ? "supabase" : "mock";

let sb: SupabaseClient | null = null;

/** Shared Supabase client; the auth session persists in AsyncStorage. */
export function getSupabase(): SupabaseClient {
  if (!sb) {
    if (BACKEND !== "supabase") throw new Error("Supabase backend is not enabled");
    sb = createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return sb;
}
