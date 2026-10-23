import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncFlushHead } from "../lib/sync-flush-head";

export interface BallData {
  id: string;
  matchId: string;
  /** UUID of match_innings row — required to sync to scoring-service */
  inningsId?: string;
  innings: number;
  over: number;
  ball: number;
  runs: number;
  isWicket: boolean;
  wicketType?: string;
  /** Batch 102: canonical wicket attribution (ENH-03-02). Optional — the
   *  contracts adapter forwards both; older queued entries omit them and the
   *  server fold default (striker) + self-heal still applies. */
  wicketPlayerOutId?: string;
  wicketFielderId?: string;
  batsmanId?: string;
  bowlerId?: string;
  isWide?: boolean;
  isNoBall?: boolean;
  isBye?: boolean;
  isLegBye?: boolean;
  /** SCORE-11 writer fencing: last observed session epoch/revision. */
  handoverEpoch?: number;
  expectedRevision?: number;
  /** SCORE-09: the signed-in account that recorded this delivery. */
  accountId: string;
  /** A revision conflict stopped the sync — review, never auto-overwrite. */
  conflicted?: boolean;
  timestamp: number;
  synced: boolean;
}

/**
 * Batch 102: the last service-confirmed crease projection for an innings,
 * captured from a record acknowledgement. This is OBSERVED canonical state
 * (the scoring service folds the delivery log; the device only caches what
 * the service said) — it feeds the run-out victim picker. An absent/stale or
 * unconfirmed entry means the picker is not offered and the record carries
 * no victim id; the server fold default + self-heal still applies.
 */
export interface CreaseAck {
  strikerId: string | null;
  nonStrikerId: string | null;
  confirmed: boolean;
  observedAt: number;
}

/** Bounded memory: at most this many innings keep a cached crease ack. */
const MAX_CREASE_ACKS = 40;

interface OfflineStore {
  isOnline: boolean;
  pendingBalls: BallData[];
  creaseByInnings: Record<string, CreaseAck>;
  setOnline: (online: boolean) => void;
  addPendingBall: (ball: BallData) => void;
  /** Batch 102: cache the crease projection from a record acknowledgment. */
  recordCreaseAck: (inningsId: string, ack: Omit<CreaseAck, "observedAt">) => void;
  markBallSynced: (ballId: string) => void;
  markBallConflicted: (ballId: string) => void;
  clearSyncedBalls: () => void;
  /** Deliveries recorded by THIS signed-in account only (SCORE-09). */
  getPendingBalls: (matchId?: string, accountId?: string) => BallData[];
  getConflictedBalls: (matchId?: string, accountId?: string) => BallData[];
}

const inScope = (ball: BallData, matchId?: string, accountId?: string) => {
  // Account-scoped entries sync ONLY for the SAME signed-in account.
  // Legacy entries saved with no account are quarantined forever: the
  // canonical gate identifies their author server-side, not this device.
  if (ball.accountId !== accountId) return false;
  if (matchId && ball.matchId !== matchId) return false;
  return !ball.synced;
};

export const useOfflineStore = create<OfflineStore>()(
  persist(
    (set, get) => ({
      isOnline: true,
      pendingBalls: [],
      creaseByInnings: {},
      setOnline: (online) => set({ isOnline: online }),
      addPendingBall: (ball) =>
        set((state) => ({
          pendingBalls: [...state.pendingBalls, ball],
        })),
      recordCreaseAck: (inningsId, ack) =>
        set((state) => {
          const next: Record<string, CreaseAck> = {
            ...state.creaseByInnings,
            [inningsId]: { ...ack, observedAt: Date.now() },
          };
          // Bounded memory: keep only the most recent innings acks.
          const oldestFirst = Object.entries(next).sort(
            ([, a], [, b]) => a.observedAt - b.observedAt
          );
          while (oldestFirst.length > MAX_CREASE_ACKS) {
            const [staleId] = oldestFirst.shift()!;
            delete next[staleId];
          }
          return { creaseByInnings: next };
        }),
      markBallSynced: (ballId) =>
        set((state) => ({
          pendingBalls: state.pendingBalls.map((ball) =>
            ball.id === ballId ? { ...ball, synced: true } : ball
          ),
        })),
      markBallConflicted: (ballId) =>
        set((state) => ({
          pendingBalls: state.pendingBalls.map((ball) =>
            ball.id === ballId ? { ...ball, conflicted: true } : ball
          ),
        })),
      clearSyncedBalls: () =>
        set((state) => ({
          pendingBalls: state.pendingBalls.filter((ball) => !ball.synced),
        })),
      getPendingBalls: (matchId, accountId) => {
        // ENH-01-04 (SCORE-14 conflict-head barrier): the queue is causal
        // order, so a conflicted entry fences everything behind it until
        // review resolves it. It is NOT skipped here - skipping let the next
        // sync tick flush later deliveries on top of an unresolved conflict.
        return syncFlushHead(
          get().pendingBalls.filter((ball) => inScope(ball, matchId, accountId))
        );
      },
      getConflictedBalls: (matchId, accountId) => {
        return get().pendingBalls.filter(
          (ball) => inScope(ball, matchId, accountId) && ball.conflicted
        );
      },
    }),
    {
      name: "offline-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
