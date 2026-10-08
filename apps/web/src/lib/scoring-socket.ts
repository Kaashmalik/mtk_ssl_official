"use client";

import { io, type Socket } from "socket.io-client";

export type ScoringScorecard = {
  matchId: string;
  innings: number;
  totalRuns: number;
  totalWickets: number;
  overs: number;
  balls: number;
  runRate: number;
};

export type ScoringMatchState = {
  matchId: string;
  status: string;
  innings1?: ScoringScorecard;
  innings2?: ScoringScorecard;
  currentInnings: number;
};

const DEFAULT_WS_URL = "http://localhost:4002";

function resolveWsUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_WS_URL?.trim() ||
    process.env.NEXT_PUBLIC_SCORING_WS_URL?.trim() ||
    DEFAULT_WS_URL;
  // Browser Socket.IO expects http(s); convert ws(s) schemes.
  return raw.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
}

function resolveAuthToken(): string | undefined {
  const token = process.env.NEXT_PUBLIC_SCORING_WS_TOKEN?.trim();
  if (!token) return undefined;
  if (/your_|replace_with|placeholder|changeme/i.test(token)) return undefined;
  return token;
}

let sharedSocket: Socket | null = null;

/**
 * Shared Socket.IO client for scoring-service `/scoring` namespace.
 * Reuses one connection across scoreboard UIs; reconnect with backoff.
 */
export function getScoringSocket(): Socket {
  if (sharedSocket) return sharedSocket;

  const token = resolveAuthToken();
  sharedSocket = io(`${resolveWsUrl()}/scoring`, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 12000,
    auth: token ? { token } : undefined,
  });

  return sharedSocket;
}

export function disconnectScoringSocket(): void {
  if (!sharedSocket) return;
  sharedSocket.removeAllListeners();
  sharedSocket.disconnect();
  sharedSocket = null;
}
