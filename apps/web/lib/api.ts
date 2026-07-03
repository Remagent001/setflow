"use client";

// Single ApiClient instance for the web app. Mock mode persisted to
// localStorage so created data survives reloads; the switch to the real
// Supabase client happens here (one file) once Supabase Auth lands.

import { createMockApiClient, type ApiClient, type MockStore } from "@setflow/api-client";

const STORE_KEY = "setflow-mock-db";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (client) return client;
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
