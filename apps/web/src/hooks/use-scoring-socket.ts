"use client";

import { useEffect } from "react";
import { getScoringSocket } from "@/lib/scoring-socket";
import { subscribeToLiveMatch } from "@/lib/live-scoring-connection";

/** Every connection/reconnection requests a complete, fresh innings snapshot. */
export function useScoringSocket(matchId: string | undefined) {
  useEffect(() => {
    if (!matchId) return;
    return subscribeToLiveMatch(getScoringSocket(), matchId);
  }, [matchId]);
}
