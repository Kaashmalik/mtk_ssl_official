"use client";

import { useEffect, useState } from "react";
import { getScoringSocket } from "@/lib/scoring-socket";
import { subscribeToLiveMatch } from "@/lib/live-scoring-connection";

/** Every connection/reconnection requests a complete, fresh innings snapshot. */
export function useScoringSocket(matchId: string | undefined, tenantId: string | undefined) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setUnavailable(false);
    if (!matchId || !tenantId) return;
    return subscribeToLiveMatch(getScoringSocket(), matchId, tenantId, undefined, setUnavailable);
  }, [matchId, tenantId]);
  return { unavailable };
}
