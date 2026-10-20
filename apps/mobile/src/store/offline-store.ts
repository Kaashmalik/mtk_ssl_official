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

interface OfflineStore {
  isOnline: boolean;
  pendingBalls: BallData[];
  setOnline: (online: boolean) => void;
  addPendingBall: (ball: BallData) => void;
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
      setOnline: (online) => set({ isOnline: online }),
      addPendingBall: (ball) =>
        set((state) => ({
          pendingBalls: [...state.pendingBalls, ball],
        })),
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
