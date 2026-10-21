import { useEffect, useRef } from "react";
import * as Network from "expo-network";
import { Platform } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import { useOfflineStore } from "@/store/offline-store";
import { appApiUrl } from "@/lib/app-api";
import { isScoringAcknowledgement } from "@/lib/scoring-ack";

/**
 * SCORE-08/09: flushes queued offline deliveries THROUGH THE AUTHENTICATED
 * WEB INTAKE (`/api/mobile/scoring/ball`, Clerk bearer). The route resolves
 * tenant/actor authority server-side; the device never calls the scoring
 * service directly. Deliveries sync only for the signed-in account that
 * recorded them (SCORE-09): another account's saved work stays quarantined
 * on the device and is never sent from this session. The server revalidates
 * queue ownership again on every submission — this filter is hygiene, not
 * authority.
 *
 * Mounted ONLY inside ClerkProvider (via the SyncBridge in _layout).
 */
export function useOfflineSync() {
  const syncInFlight = useRef(false);
  const { isSignedIn, getToken, userId } = useAuth();
  const { isOnline, setOnline, getPendingBalls, markBallSynced, markBallConflicted, clearSyncedBalls } =
    useOfflineStore();

  const logSyncError = (error: unknown) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error("Failed to sync ball:", error);
    }
  };

  useEffect(() => {
    const checkNetwork = async () => {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined") {
          setOnline(navigator.onLine);
        }
        return;
      }
      const networkState = await Network.getNetworkStateAsync();
      setOnline(networkState.isConnected ?? false);
    };

    checkNetwork();
    const interval = setInterval(checkNetwork, 5000);

    return () => clearInterval(interval);
  }, [setOnline]);

  useEffect(() => {
    if (!isOnline || !isSignedIn || !userId) return;
    const base = appApiUrl();

    const syncPendingBalls = async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      try {
        const token = await getToken();
        if (!token) {
          logSyncError(new Error("No session token available; sync deferred"));
          return;
        }

        // SCORE-09: only THIS signed-in account's acceptable deliveries.
        const pendingBalls = getPendingBalls(undefined, userId);

        // ENH-03-02: the revision fence is chained from acknowledgements.
        // Every accepted delivery bumps the official revision, so the NEXT
        // queued ball's fence is the ack's revision — reusing the frozen
        // per-ball snapshot used to guarantee one ball per sync forever.
        let chainedExpectedRevision: number | undefined;

        for (const ball of pendingBalls) {
          try {
            if (!ball.inningsId || !ball.batsmanId || !ball.bowlerId) {
              // Unsatisfiable entries can never pass the canonical gate;
              // isolate them for review instead of blocking the whole queue.
              logSyncError(new Error(`Delivery ${ball.id} is missing required scoring identifiers; kept for review`));
              markBallConflicted(ball.id);
              continue;
            }

            // ENH-03-02: the flat boolean command is the ONLY wire shape. The
            // nested extras/wicket merge previously sent here was stripped by
            // the intake schema — every mobile wicket silently vanished. Now
            // each flag the screen set reaches the boundary as itself; the
            // intake's contracts adapter remains for OLDER installed payloads.
            const res = await fetch(`${base}/api/mobile/scoring/ball`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                clientOpId: ball.id, matchId: ball.matchId, inningsId: ball.inningsId,
                overNumber: ball.over, ballNumber: ball.ball, runs: ball.runs,
                batsmanId: ball.batsmanId, bowlerId: ball.bowlerId,
                isWicket: ball.isWicket === true, wicketType: ball.isWicket ? ball.wicketType : undefined,
                isWide: ball.isWide === true, isNoBall: ball.isNoBall === true,
                isBye: ball.isBye === true, isLegBye: ball.isLegBye === true,
                handoverEpoch: ball.handoverEpoch,
                expectedRevision: chainedExpectedRevision ?? ball.expectedRevision,
              }),
            });

            if (res.status === 409) {
              // SCORE-14: the official score moved. Keep the delivery, flag
              // it for review — the device never blind-overwrites, and the
              // fenced queue stops here rather than chaining past the gap.
              markBallConflicted(ball.id);
              logSyncError(new Error(`Delivery ${ball.id} hit a scoring revision conflict; kept for review`));
              break;
            }

            const body: unknown = res.ok ? await res.json() : null;
            if (isScoringAcknowledgement(res.status, body, ball.id)) {
              markBallSynced(ball.id);
              const revision = (body as { scoringRevision?: unknown } | null)?.scoringRevision;
              if (typeof revision === "number" && Number.isInteger(revision) && revision >= 0) {
                chainedExpectedRevision = revision;
              }
            } else {
              // A specific rejected delivery is isolated (poison-ball), not a
              // head-of-line block: the intent stays on the device for review
              // and the rest of the queue still syncs. Nothing is dropped.
              logSyncError(new Error(`Scoring acknowledgement rejected (HTTP ${res.status}); delivery ${ball.id} kept for review`));
              markBallConflicted(ball.id);
              continue;
            }
          } catch (error) {
            // Network/transport failure: stop — the queue order matters and
            // the next tick retries from the same head.
            logSyncError(error);
            break;
          }
        }
        clearSyncedBalls();
      } finally {
        syncInFlight.current = false;
      }
    };

    syncPendingBalls();
    const interval = setInterval(syncPendingBalls, 10000);

    return () => clearInterval(interval);
  }, [isOnline, isSignedIn, userId, getToken, getPendingBalls, markBallSynced, markBallConflicted, clearSyncedBalls]);
}
