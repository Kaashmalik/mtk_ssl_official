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

        for (const ball of pendingBalls) {
          try {
            if (!ball.inningsId || !ball.batsmanId || !ball.bowlerId) {
              // Unsatisfiable entries can never pass the canonical gate; stop
              // and surface rather than silently looping forever.
              logSyncError(new Error(`Delivery ${ball.id} is missing required scoring identifiers`));
              break;
            }

            let extras: { type: string; runs: number } | undefined;
            if (ball.isWide) extras = { type: "wide", runs: Math.max(1, ball.runs) };
            else if (ball.isNoBall) extras = { type: "noball", runs: Math.max(1, ball.runs) };
            else if (ball.isBye) extras = { type: "bye", runs: ball.runs };
            else if (ball.isLegBye) extras = { type: "legbye", runs: ball.runs };

            const wicket = ball.isWicket && ball.wicketType
              ? { type: ball.wicketType, playerId: ball.batsmanId } : undefined;
            const res = await fetch(`${base}/api/mobile/scoring/ball`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                clientOpId: ball.id, matchId: ball.matchId, inningsId: ball.inningsId,
                overNumber: ball.over, ballNumber: ball.ball, runs: ball.runs,
                batsmanId: ball.batsmanId, bowlerId: ball.bowlerId, extras, wicket,
                handoverEpoch: ball.handoverEpoch, expectedRevision: ball.expectedRevision,
              }),
            });

            if (res.status === 409) {
              // SCORE-14: the official score moved. Keep the delivery, flag
              // it for review — the device never blind-overwrites.
              markBallConflicted(ball.id);
              logSyncError(new Error(`Delivery ${ball.id} hit a scoring revision conflict; kept for review`));
              break;
            }

            const acknowledgement: unknown = res.ok ? await res.json() : null;
            if (isScoringAcknowledgement(res.status, acknowledgement, ball.id)) {
              markBallSynced(ball.id);
            } else {
              logSyncError(new Error(`Scoring acknowledgement rejected (HTTP ${res.status})`));
              break;
            }
          } catch (error) {
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
