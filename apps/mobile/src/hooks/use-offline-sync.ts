import { useEffect } from "react";
import * as Network from "expo-network";
import Constants from "expo-constants";
import { useOfflineStore } from "@/store/offline-store";
import { Platform } from "react-native";

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
      const pendingBalls = getPendingBalls();
      const base = scoringServiceUrl();

      for (const ball of pendingBalls) {
        try {
          if (!ball.inningsId || !ball.batsmanId || !ball.bowlerId) {
            logSyncError(
              new Error(
                `Skipping ball ${ball.id}: missing inningsId/batsmanId/bowlerId for scoring-service`,
              ),
            );
            continue;
          }

          let extras: { type: string; runs: number } | undefined;
          if (ball.isWide) extras = { type: "wide", runs: Math.max(1, ball.runs) };
          else if (ball.isNoBall) extras = { type: "noball", runs: Math.max(1, ball.runs) };
          else if (ball.isBye) extras = { type: "bye", runs: ball.runs };
          else if (ball.isLegBye) extras = { type: "legbye", runs: ball.runs };

          const wicket =
            ball.isWicket && ball.wicketType
              ? { type: ball.wicketType, playerId: ball.batsmanId }
              : undefined;

          const res = await fetch(`${base}/scoring/ball`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              matchId: ball.matchId,
              inningsId: ball.inningsId,
              over: ball.over,
              ball: ball.ball,
              runs: ball.runs,
              batsmanId: ball.batsmanId,
              bowlerId: ball.bowlerId,
              extras,
              wicket,
            }),
          });

          if (res.ok || res.status === 400) {
            // 400 often means duplicate ball already applied — treat as synced
            markBallSynced(ball.id);
          } else {
            logSyncError(new Error(`HTTP ${res.status}`));
          }
        } catch (error) {
          logSyncError(error);
        }
      }

      clearSyncedBalls();
    };

    syncPendingBalls();
    const interval = setInterval(syncPendingBalls, 10000);

    return () => clearInterval(interval);
  }, [isOnline, getPendingBalls, markBallSynced, clearSyncedBalls]);
}
