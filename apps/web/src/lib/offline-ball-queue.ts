"use client";

/**
 * Offline ball queue for web scoring.
 *
 * Balls recorded while offline are persisted to IndexedDB and replayed in
 * order once connectivity returns. Each entry carries the clientOpId used by
 * match_balls for idempotency, so a replay after a partial failure cannot
 * double-count a ball.
 */

const DB_NAME = "ssl-offline";
const DB_VERSION = 1;
const STORE = "pendingBalls";

export interface QueuedBall {
  clientOpId: string;
  matchId: string;
  inningsId: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientOpId" });
        store.createIndex("matchId", "matchId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueBall(ball: Omit<QueuedBall, "queuedAt" | "attempts">): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...ball, queuedAt: Date.now(), attempts: 0 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getQueuedBalls(matchId?: string): Promise<QueuedBall[]> {
  const db = await openDb();
  const rows = await new Promise<QueuedBall[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedBall[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  const filtered = matchId ? rows.filter((r) => r.matchId === matchId) : rows;
  return filtered.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function removeQueuedBall(clientOpId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientOpId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function incrementAttempts(clientOpId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(clientOpId);
    get.onsuccess = () => {
      const row = get.result as QueuedBall | undefined;
      if (row) store.put({ ...row, attempts: row.attempts + 1 });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function countQueuedBalls(matchId?: string): Promise<number> {
  return (await getQueuedBalls(matchId)).length;
}

export async function clearQueue(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}