// Single ApiClient for the mobile app (Segment 17: offline-first).
// The mock store hydrates from AsyncStorage at launch and every write is
// persisted back, so workouts, history, and journals survive app restarts
// and work with zero connectivity. When the real Supabase backend is wired
// in, this same write path becomes the sync queue.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createMockApiClient, type ApiClient, type MockStore } from "@setflow/api-client";

const STORE_KEY = "setflow-db-v1";

let client: ApiClient | null = null;

// Tiny sync-status store: how many writes are still flushing to disk.
let pendingWrites = 0;
let lastSavedAt: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getSyncStatus(): { pendingWrites: number; lastSavedAt: number | null } {
  return { pendingWrites, lastSavedAt };
}
export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hydrate the store from disk and build the client. Call once at launch. */
export async function initApi(): Promise<ApiClient> {
  if (client) return client;
  let hydrated: MockStore | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    hydrated = raw ? (JSON.parse(raw) as MockStore) : null;
  } catch {
    hydrated = null; // corrupted/missing cache: fall back to the seed
  }
  client = createMockApiClient({
    storage: {
      load: () => hydrated,
      save(store: MockStore) {
        pendingWrites++;
        notify();
        AsyncStorage.setItem(STORE_KEY, JSON.stringify(store))
          .then(() => {
            lastSavedAt = Date.now();
          })
          .catch(() => {
            // Disk write failed; data stays live in memory and the next
            // write retries the full snapshot.
          })
          .finally(() => {
            pendingWrites--;
            notify();
          });
      },
    },
  });
  return client;
}

export function getApi(): ApiClient {
  if (!client) throw new Error("initApi() must complete before getApi()");
  return client;
}

export const MOCK_USER_ID = "mock-user";
