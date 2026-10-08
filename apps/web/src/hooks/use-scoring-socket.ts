"use client";

import { useEffect, useRef } from "react";
import {
  getScoringSocket,
  type ScoringMatchState,
  type ScoringScorecard,
} from "@/lib/scoring-socket";
import { useScoringStore, type InningsState } from "@/stores/scoring-store";
import { useCommentaryStore } from "@/stores/commentary-store";

function applyScorecardToInnings(
  innings: InningsState | null,
  scorecard: ScoringScorecard,
): InningsState | null {
  if (!innings) return innings;
  const totalBalls = scorecard.overs * 6 + scorecard.balls;
  return {
    ...innings,
    totalRuns: scorecard.totalRuns,
    totalWickets: scorecard.totalWickets,
    totalBalls,
    currentOver: scorecard.overs,
    currentBall: scorecard.balls,
    status: "in_progress",
  };
}

/**
 * Connects to scoring-service WS, joins the match room, and keeps
 * the Zustand scoreboard / online indicator in sync.
 */
export function useScoringSocket(matchId: string | undefined) {
  const setOnline = useScoringStore((s) => s.setOnline);
  const joinedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!matchId) return;

    const socket = getScoringSocket();
    let cancelled = false;

    const join = () => {
      if (cancelled) return;
      socket.emit(
        "join-match",
        { matchId },
        (ack?: { success?: boolean; error?: string }) => {
          if (ack && ack.success === false) {
            console.warn("[scoring-ws] join-match failed:", ack.error);
            return;
          }
          joinedRef.current = matchId;
        },
      );
    };

    const onConnect = () => {
      setOnline(true);
      join();
    };

    const onDisconnect = () => {
      setOnline(false);
      joinedRef.current = null;
    };

    const onScoreUpdate = (scorecard: ScoringScorecard) => {
      if (!scorecard?.matchId || scorecard.matchId !== matchId) return;
      const state = useScoringStore.getState();
      if (state.matchId !== matchId) return;

      if (scorecard.innings === 1) {
        useScoringStore.setState({
          innings1: applyScorecardToInnings(state.innings1, scorecard),
        });
      } else if (scorecard.innings === 2) {
        useScoringStore.setState({
          innings2: applyScorecardToInnings(state.innings2, scorecard),
        });
      }
    };

    const onMatchState = (matchState: ScoringMatchState | null) => {
      if (!matchState || matchState.matchId !== matchId) return;
      const state = useScoringStore.getState();
      if (state.matchId !== matchId) return;

      const next: Partial<typeof state> = {
        currentInnings:
          matchState.currentInnings === 2
            ? 2
            : matchState.currentInnings === 1
              ? 1
              : state.currentInnings,
      };
      if (matchState.innings1) {
        next.innings1 = applyScorecardToInnings(
          state.innings1,
          matchState.innings1,
        );
      }
      if (matchState.innings2) {
        next.innings2 = applyScorecardToInnings(
          state.innings2,
          matchState.innings2,
        );
      }
      useScoringStore.setState(next);
    };

    const onCommentaryUpdate = (entry: Parameters<ReturnType<typeof useCommentaryStore.getState>["addEntry"]>[0]) => {
      if (!entry?.matchId || entry.matchId !== matchId) return;
      useCommentaryStore.getState().addEntry(entry);
    };

    const onBrowserOnline = () => {
      setOnline(true);
      if (!socket.connected) socket.connect();
    };
    const onBrowserOffline = () => setOnline(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("score-update", onScoreUpdate);
    socket.on("match-state", onMatchState);
    socket.on("commentary-update", onCommentaryUpdate);
    window.addEventListener("online", onBrowserOnline);
    window.addEventListener("offline", onBrowserOffline);

    setOnline(socket.connected || navigator.onLine);
    if (!socket.connected) {
      socket.connect();
    } else {
      join();
    }

    return () => {
      cancelled = true;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("score-update", onScoreUpdate);
      socket.off("match-state", onMatchState);
      socket.off("commentary-update", onCommentaryUpdate);
      window.removeEventListener("online", onBrowserOnline);
      window.removeEventListener("offline", onBrowserOffline);

      if (joinedRef.current === matchId) {
        socket.emit("leave-match", { matchId });
        joinedRef.current = null;
      }
    };
  }, [matchId, setOnline]);
}
