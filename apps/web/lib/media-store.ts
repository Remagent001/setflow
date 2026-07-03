"use client";

// Local video-blob storage for mock mode. Video files are far too big for
// localStorage (the mock store's ~5MB quota), so the bytes live in
// IndexedDB and the mock store only keeps metadata with a
// `local-media://<key>` URL. When the app moves to Supabase, uploads go to
// a Storage bucket instead and these URLs become https ones — the swap
// point stays in lib/api.ts / this file.

const DB_NAME = "setflow-media";
const STORE = "videos";
export const LOCAL_MEDIA_PREFIX = "local-media://";

export const isLocalMediaUrl = (url: string) => url.startsWith(LOCAL_MEDIA_PREFIX);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Store a video blob; returns the local-media:// URL to save as media metadata. */
export async function saveVideoBlob(blob: Blob): Promise<string> {
  const key = window.crypto.randomUUID();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    await txDone(tx);
    return `${LOCAL_MEDIA_PREFIX}${key}`;
  } finally {
    db.close();
  }
}

/** Fetch a stored blob by its local-media:// URL; null if missing (e.g. browser data cleared). */
export async function getVideoBlob(localUrl: string): Promise<Blob | null> {
  const key = localUrl.slice(LOCAL_MEDIA_PREFIX.length);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    await txDone(tx);
    return (req.result as Blob | undefined) ?? null;
  } finally {
    db.close();
  }
}

/** Delete the stored blob for a local-media:// URL. No-op for external URLs. */
export async function deleteVideoBlob(url: string): Promise<void> {
  if (!isLocalMediaUrl(url)) return;
  const key = url.slice(LOCAL_MEDIA_PREFIX.length);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    await txDone(tx);
  } finally {
    db.close();
  }
}
