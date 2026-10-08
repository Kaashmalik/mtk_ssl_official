"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getQueuedBalls,
  removeQueuedBall,
  incrementAttempts,
  countQueuedBalls,
  type QueuedBall,
} from "@/lib/offline-ball-queue";

const MAX_ATTEMPTS = 5;

/**
 * Replays offline balls through the normal recordBall server action.
 * Entries are removed only after a successful write, so an interrupted sync
 * resumes rather than losing deliveries.
 */
export function useOfflineBallSync(onSynced?: (count: number) => void) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setPending(await countQueuedBalls());
  }, []);

  const sync = useCallback(
    async (recordBall: (input: Record<string, unknown>) => Promise<unknown>) => {
      if (syncing) return;
      const queue = await getQueuedBalls();
      if (queue.length === 0) {
        setPending(0);
        return;
      }

      setSyncing(true);
      let synced = 0;

      for (const item of queue as QueuedBall[]) {
        if (item.attempts >= MAX_ATTEMPTS) {
          // Give up on this entry rather than blocking the queue forever.
          await removeQueuedBall(item.clientOpId);
          toast.error(`Dropped an unsynced ball (${item.attempts} failed attempts)`);
          continue;
        }
        try {
          await recordBall(item.payload);
          await removeQueuedBall(item.clientOpId);
          synced++;
        } catch {
          await incrementAttempts(item.clientOpId);
          break; // likely still offline — stop and retry later
        }
      }

      await refresh();
      setSyncing(false);
      if (synced > 0) {
        toast.success(`Synced ${synced} offline ball${synced === 1 ? "" : "s"}`);
        onSynced?.(synced);
      }
    },
    [syncing, refresh, onSynced],
  );

  useEffect(() => {
    refresh();
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  return { pending, syncing, sync, refresh };
}