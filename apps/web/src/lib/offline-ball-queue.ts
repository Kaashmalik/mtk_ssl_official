"use client";

import { queueItemInScope, scoringQueueKey, validQueueScope, type ScoringQueueScope } from "./scoring-queue-scope";

const DB_NAME = "ssl-offline";
const DB_VERSION = 2;
// The v1 pendingBalls store is deliberately retained and NEVER adopted by a new session.
const STORE = "scopedPendingBalls";

export interface QueuedBall {
  clientOpId: string;
  matchId: string;
  inningsId: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  accountId?: string;
  tenantId?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: ["scopeKey", "clientOpId"] });
        store.createIndex("scope", "scopeKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueBall(ball: Omit<QueuedBall, "queuedAt" | "attempts">, scope: ScoringQueueScope): Promise<void> {
  const scopeKey = scoringQueueKey(scope);
  if (ball.matchId !== scope.matchId || ball.payload.matchId !== scope.matchId) throw new Error("Saved delivery does not match its verified workspace");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const read = store.get([scopeKey, ball.clientOpId]);
      read.onsuccess = () => {
        if (read.result) {
          // Do not rewrite a saved command's content, epoch, revision or retry history.
          if (JSON.stringify(read.result.payload) !== JSON.stringify(ball.payload)) {
            tx.abort();
            reject(new Error("Saved operation changed. Review the original delivery before retrying."));
          }
          return;
        }
        store.put({ ...ball, ...scope, scopeKey, queuedAt: Date.now(), attempts: 0 });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Delivery save was aborted"));
    });
  } finally { db.close(); }
}

export async function getQueuedBalls(matchId: string, scope?: ScoringQueueScope | null): Promise<QueuedBall[]> {
  if (!validQueueScope(scope) || scope.matchId !== matchId) return [];
  const db = await openDb();
  try {
    const rows = await new Promise<QueuedBall[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).index("scope").getAll(scoringQueueKey(scope));
      req.onsuccess = () => resolve(req.result as QueuedBall[]);
      req.onerror = () => reject(req.error);
    });
    return rows.filter(row => queueItemInScope(row, scope)).sort((a, b) => a.queuedAt - b.queuedAt || a.clientOpId.localeCompare(b.clientOpId));
  } finally { db.close(); }
}

async function changeQueuedBall(clientOpId: string, scope: ScoringQueueScope, remove: boolean): Promise<void> {
  const scopeKey = scoringQueueKey(scope);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const key = [scopeKey, clientOpId];
      const req = store.get(key);
      req.onsuccess = () => {
        if (!req.result || !queueItemInScope(req.result, scope)) return;
        if (remove) store.delete(key);
        else store.put({ ...req.result, attempts: req.result.attempts + 1 });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Queue change was aborted"));
    });
  } finally { db.close(); }
}

export const removeQueuedBall = (clientOpId: string, scope: ScoringQueueScope) => changeQueuedBall(clientOpId, scope, true);
export const incrementAttempts = (clientOpId: string, scope: ScoringQueueScope) => changeQueuedBall(clientOpId, scope, false);
export async function countQueuedBalls(matchId: string, scope?: ScoringQueueScope | null): Promise<number> {
  return (await getQueuedBalls(matchId, scope)).length;
}
