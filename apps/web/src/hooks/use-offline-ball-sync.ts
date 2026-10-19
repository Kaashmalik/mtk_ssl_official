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
import { validQueueScope, type ScoringQueueScope } from "@/lib/scoring-queue-scope";

/**
 * Replays offline balls through the normal recordBall server action.
 * Entries are removed only after a successful write, so an interrupted sync
 * resumes rather than losing deliveries.
 */
export function useOfflineBallSync(matchId: string, scope?: ScoringQueueScope | null, onSynced?: (count: number) => void) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);

  const refresh = useCallback(async () => {
    setPending(await countQueuedBalls(matchId, scope));
  }, [matchId, scope]);

  const sync = useCallback(
    async (recordBall: (input: Record<string, unknown>) => Promise<unknown>) => {
      if (syncInFlight.current || !validQueueScope(scope)) return;
      syncInFlight.current = true;
      setSyncing(true);
      try {
        const queue = await getQueuedBalls(matchId, scope);
        const { synced, blocked } = await replayBallQueue(queue, {
          record: recordBall, remove: id => removeQueuedBall(id, scope),
          incrementAttempts: id => incrementAttempts(id, scope),
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
    [matchId, scope, refresh, onSynced],
  );

  useEffect(() => {
    refresh();
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  return { pending, syncing, sync, refresh };
}
