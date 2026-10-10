"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getQueuedBalls,
  removeQueuedBall,
  incrementAttempts,
  countQueuedBalls,
} from "@/lib/offline-ball-queue";
import { replayBallQueue } from "@/lib/replay-ball-queue";

/**
 * Replays offline balls through the normal recordBall server action.
 * Entries are removed only after a successful write, so an interrupted sync
 * resumes rather than losing deliveries.
 */
export function useOfflineBallSync(matchId: string, onSynced?: (count: number) => void) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);

  const refresh = useCallback(async () => {
    setPending(await countQueuedBalls(matchId));
  }, [matchId]);

  const sync = useCallback(
    async (recordBall: (input: Record<string, unknown>) => Promise<unknown>) => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setSyncing(true);
      try {
        const queue = await getQueuedBalls(matchId);
        const { synced, blocked } = await replayBallQueue(queue, {
          record: recordBall, remove: removeQueuedBall, incrementAttempts,
        });
        if (blocked) toast.error("A delivery could not sync. It is saved on this device; retry after checking the match.");
        if (synced > 0) {
          toast.success(`Synced ${synced} offline ball${synced === 1 ? "" : "s"}`);
          onSynced?.(synced);
        }
      } catch (error) {
        console.error("Offline scoring queue unavailable:", error);
        toast.error("Could not access saved deliveries. Your queue has not been cleared.");
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
        await refresh();
      }
    },
    [matchId, refresh, onSynced],
  );

  useEffect(() => {
    refresh();
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  return { pending, syncing, sync, refresh };
}
