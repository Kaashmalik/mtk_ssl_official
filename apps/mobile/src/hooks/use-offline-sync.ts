import { useEffect, useRef } from "react";
import * as Network from "expo-network";
import Constants from "expo-constants";
import { useOfflineStore } from "@/store/offline-store";
import { Platform } from "react-native";
import { isScoringAcknowledgement } from "@/lib/scoring-ack";

function scoringServiceUrl(): string {
  return (
    Constants.expoConfig?.extra?.scoringServiceUrl ||
    process.env.EXPO_PUBLIC_SCORING_SERVICE_URL ||
    "http://localhost:4002"
  ).replace(/\/$/, "");
}

/**
 * Flushes queued offline balls to Nest scoring-service (canonical SoT).
 * Does not write via anon Supabase PostgREST — that path is RLS-denied and schema-mismatched.
 */
export function useOfflineSync() {
  const syncInFlight = useRef(false);
  const { isOnline, setOnline, getPendingBalls, markBallSynced, clearSyncedBalls } =
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
    if (!isOnline) return;

    const syncPendingBalls = async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      try {
        const pendingBalls = getPendingBalls();
        const base = scoringServiceUrl();

        for (const ball of pendingBalls) {
          try {
            if (!ball.inningsId || !ball.batsmanId || !ball.bowlerId) {
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
            const res = await fetch(`${base}/scoring/ball`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientOpId: ball.id, matchId: ball.matchId, inningsId: ball.inningsId,
                over: ball.over, ball: ball.ball, runs: ball.runs,
                batsmanId: ball.batsmanId, bowlerId: ball.bowlerId, extras, wicket,
              }),
            });

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
  }, [isOnline, getPendingBalls, markBallSynced, clearSyncedBalls]);
}
