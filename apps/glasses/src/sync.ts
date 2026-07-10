// Glasses ↔ cloud sync. The glasses hold a durable device TOKEN (in their URL)
// and talk to two Supabase SECURITY DEFINER functions with plain fetch:
//   glasses_get_plan   -> the paired user's live plans (offline-cached locally)
//   glasses_sync_session -> one finished workout bundle (offline-queued locally)
// No supabase-js, no auth session, no service key. Everything is offline-first:
// the plan renders from cache instantly and finished workouts queue in an
// outbox that flushes when there's a connection.

import type { EngineWorkout } from "../../../packages/workout-engine/src/engine";
import { SUPABASE_URL, SUPABASE_ANON } from "./config.ts";

const TOKEN_KEY = "sf.token";
const PLAN_KEY = "sf.plan";
const OUTBOX_KEY = "sf.outbox";
const DEAD_KEY = "sf.deadletter"; // bundles the server rejected as stale

export type SyncLog = {
  workoutStepId: string;
  exerciseId: string;
  setNumber: number;
  targetWeight?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  actualWeight?: number;
  actualReps?: number;
  actualDurationSeconds?: number;
  unit: string;
  status: string;
};

export type SyncBundle = {
  clientId: string; // stable per finished workout -> server dedupes retries
  planId: string;
  startedAt: string;
  durationSeconds: number;
  status: "completed";
  logs: SyncLog[];
  rollforward: { stepId: string; targetWeight?: number; targetReps?: number }[];
};

export type FlushSummary = { synced: number; deadlettered: number; remaining: number };

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full - fine */
  }
}

/** Token from the URL (?t=...), persisted so it survives a param-less reload. */
export function getToken(): string | null {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URL(location.href).searchParams.get("t");
  } catch {
    fromUrl = null;
  }
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* fine */
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

/** What our two RPCs can return (trusted server, loose but typed). */
type RpcResponse = {
  workouts?: EngineWorkout[];
  sessionId?: string;
  idempotent?: boolean;
  error?: string;
};

async function rpc(fn: string, body: Record<string, unknown>): Promise<RpcResponse> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status}`);
  return (await res.json()) as RpcResponse;
}

export type PlanResult = { workouts: EngineWorkout[] } | { error: string };

/** Fetch the paired user's live plans; caches on success. */
export async function fetchPlan(token: string): Promise<PlanResult> {
  const data = await rpc("glasses_get_plan", { p_token: token });
  if (data && Array.isArray(data.workouts)) {
    saveCachedPlan(data.workouts as EngineWorkout[]);
    return { workouts: data.workouts as EngineWorkout[] };
  }
  return { error: (data && data.error) || "unknown" };
}

export function loadCachedPlan(): EngineWorkout[] | null {
  const p = readJson<EngineWorkout[] | null>(PLAN_KEY, null);
  return p && p.length ? p : null;
}
export function saveCachedPlan(workouts: EngineWorkout[]): void {
  writeJson(PLAN_KEY, workouts);
}

export function enqueueSession(bundle: SyncBundle): void {
  const outbox = readJson<SyncBundle[]>(OUTBOX_KEY, []);
  outbox.push(bundle);
  writeJson(OUTBOX_KEY, outbox);
}
export function outboxCount(): number {
  return readJson<SyncBundle[]>(OUTBOX_KEY, []).length;
}

/** Replace a still-queued bundle's logs/rollforward (post-finish rep fixes on
 * the done card). No-op if the bundle already left the queue (synced) - in
 * that case the fix arrived too late, which the UI treats as best-effort. */
export function rewriteQueuedSession(
  clientId: string,
  patch: Pick<SyncBundle, "logs" | "rollforward">
): boolean {
  const outbox = readJson<SyncBundle[]>(OUTBOX_KEY, []);
  const i = outbox.findIndex((b) => b.clientId === clientId);
  if (i < 0) return false;
  outbox[i] = { ...outbox[i]!, ...patch };
  writeJson(OUTBOX_KEY, outbox);
  return true;
}

/**
 * Try to upload every queued workout, in order. Successes (including the
 * server reporting an already-synced duplicate) drop from the queue;
 * stale-plan rejections move to a dead-letter list (they'll never succeed as
 * is, so don't retry forever); network / bad-token failures stay queued.
 */
export async function flushOutbox(token: string): Promise<FlushSummary> {
  const outbox = readJson<SyncBundle[]>(OUTBOX_KEY, []);
  if (!outbox.length) return { synced: 0, deadlettered: 0, remaining: 0 };

  const remaining: SyncBundle[] = [];
  let synced = 0;
  let deadlettered = 0;

  for (const bundle of outbox) {
    try {
      const res = await rpc("glasses_sync_session", { p_token: token, p_session: bundle });
      if (res && res.sessionId) {
        synced++;
        continue;
      }
      if (res && res.error === "stale_plan") {
        const dead = readJson<SyncBundle[]>(DEAD_KEY, []);
        dead.push(bundle);
        writeJson(DEAD_KEY, dead);
        deadlettered++;
        continue;
      }
      // invalid_token or anything unexpected: keep it, try again later.
      remaining.push(bundle);
    } catch {
      remaining.push(bundle); // offline / server down: retry later
    }
  }

  writeJson(OUTBOX_KEY, remaining);
  return { synced, deadlettered, remaining: remaining.length };
}

/** A stable per-device id, so the fallback client id below is unique even
 * across two of the same user's devices that both lack crypto.randomUUID. */
function deviceId(): string {
  let d = "";
  try {
    d = localStorage.getItem("sf.device") ?? "";
  } catch {
    /* fine */
  }
  if (!d) {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const b = crypto.getRandomValues(new Uint8Array(6));
        d = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      }
    } catch {
      /* fall through */
    }
    if (!d) d = Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem("sf.device", d);
    } catch {
      /* fine */
    }
  }
  return d;
}

/** Stable id per finished workout, for server-side idempotency. */
export function newClientId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // Fallback: per-device id + monotonic counter (unique across devices/users).
  const n = readJson<number>("sf.seq", 0) + 1;
  writeJson("sf.seq", n);
  return `g-${deviceId()}-${n}`;
}

/** Clear the paired token + cached plan (on revocation / invalid token). */
export function clearTokenAndPlan(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PLAN_KEY);
  } catch {
    /* fine */
  }
}
