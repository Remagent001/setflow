"use client";

// Single ApiClient instance for the web app. Two modes (lib/backend.ts):
// mock (localStorage-backed, the default) or supabase (real database with
// auth-stamped ownership). Pages don't care which is active.

import {
  createMockApiClient,
  createSupabaseApiClient,
  type ApiClient,
  type MockStore,
} from "@setflow/api-client";
import { BACKEND, getSupabase } from "./backend";

const STORE_KEY = "setflow-mock-db";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (client) return client;
  if (BACKEND === "supabase") {
    client = createSupabaseApiClient({ client: getSupabase() });
    return client;
  }
  client = createMockApiClient({
    storage: {
      load(): MockStore | null {
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          return raw ? (JSON.parse(raw) as MockStore) : null;
        } catch {
          return null;
        }
      },
      save(store: MockStore) {
        try {
          window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
        } catch {
          // storage full/unavailable - keep running in-memory
        }
      },
    },
  });
  return client;
}
