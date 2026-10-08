import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type BallInput = 0 | 1 | 2 | 3 | 4 | 6 | "W" | "WD" | "NB" | "LB" | "B";
export type WicketType = "bowled" | "caught" | "lbw" | "run_out" | "stumped" | "hit_wicket";

export interface BallData {
  id: string;
  overNumber: number;
  ballNumber: number;
  input: BallInput;
  runs: number;
  isWicket: boolean;
  wicketType?: WicketType;
  isWide: boolean;
  isNoBall: boolean;
  isBye: boolean;
  isLegBye: boolean;
  isFour?: boolean;
  isSix?: boolean;
  batsmanId?: string;
  bowlerId?: string;
  shotDirection?: string;
  shotType?: string;
  timestamp: number;
}

export interface InningsState {
  inningsId: string;
  teamId: string;
  totalRuns: number;
  totalWickets: number;
  totalBalls: number;
  extras: number;
  byes: number;
  legByes: number;
  wides: number;
  noBalls: number;
  status: "not_started" | "in_progress" | "completed";
  currentOver: number;
  currentBall: number;
  balls: BallData[];
}

interface InningsHistory {
  history: InningsState[];
  historyIndex: number;
}

export interface ScoringState {
  matchId: string;
  currentInnings: 1 | 2 | "super_over";
  innings1: InningsState | null;
  innings2: InningsState | null;
  superOver: InningsState | null;
  innings1History: InningsHistory;
  innings2History: InningsHistory;
  superOverHistory: InningsHistory;
  isOnline: boolean;

  // Actions
  addBall: (ball: Omit<BallData, "id" | "timestamp">) => void;
  undo: () => void;
  redo: () => void;
  setOnline: (online: boolean) => void;
  resetInnings: (innings: 1 | 2 | "super_over") => void;
  setMatchId: (matchId: string) => void;
}

const calculateRuns = (input: BallInput): number => {
  if (typeof input === "number") return input;
  if (input === "WD" || input === "NB") return 1;
  return 0;
};

const calculateBallData = (
  input: BallInput,
  wicketType?: WicketType,
  runs?: number
): Partial<BallData> => {
  const ballRuns = runs ?? calculateRuns(input);
  const isWide = input === "WD";
  const isNoBall = input === "NB";
  const isBye = input === "B";
  const isLegBye = input === "LB";
  const isWicket = input === "W" || !!wicketType;
  const isFour = ballRuns === 4 && !isWide && !isNoBall && !isBye && !isLegBye;
  const isSix = ballRuns === 6 && !isWide && !isNoBall && !isBye && !isLegBye;

  return {
    input,
    runs: ballRuns,
    isWicket,
    wicketType,
    isWide,
    isNoBall,
    isBye,
    isLegBye,
    isFour,
    isSix,
  };
};

function createEmptyHistory(): InningsHistory {
  return { history: [], historyIndex: -1 };
}

function getInningsKey(innings: 1 | 2 | "super_over") {
  return innings === 1 ? "innings1" : innings === 2 ? "innings2" : "superOver";
}

function getHistoryKey(innings: 1 | 2 | "super_over") {
  return innings === 1 ? "innings1History" : innings === 2 ? "innings2History" : "superOverHistory";
}

export const useScoringStore = create<ScoringState>()(
  persist(
    (set, get) => ({
      matchId: "",
      currentInnings: 1,
      innings1: null,
      innings2: null,
      superOver: null,
      innings1History: createEmptyHistory(),
      innings2History: createEmptyHistory(),
      superOverHistory: createEmptyHistory(),
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,

      setMatchId: (matchId: string) => set({ matchId }),

      addBall: (ballData) => {
        const state = get();
        const inningsKey = getInningsKey(state.currentInnings) as
          "innings1" | "innings2" | "superOver";
        const historyKey = getHistoryKey(state.currentInnings) as
          "innings1History" | "innings2History" | "superOverHistory";
        const currentInnings = state[inningsKey];

        if (!currentInnings) return;

        const ball: BallData = {
          ...ballData,
          id: `ball-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          timestamp: Date.now(),
          ...calculateBallData(ballData.input, ballData.wicketType, ballData.runs),
        };

        // Incremental over/ball computation (O(1))
        const newOver = ball.isWide || ball.isNoBall
          ? currentInnings.currentOver
          : currentInnings.currentBall === 6
            ? currentInnings.currentOver + 1
            : currentInnings.currentOver;
        const newBall = ball.isWide || ball.isNoBall
          ? currentInnings.currentBall
          : currentInnings.currentBall === 6
            ? 1
            : currentInnings.currentBall + 1;

        // Incremental state update (O(1) for aggregates, O(n) for array copy only)
        const newBalls = [...currentInnings.balls, ball];
        const updatedInnings: InningsState = {
          ...currentInnings,
          totalRuns: currentInnings.totalRuns + ball.runs,
          totalWickets: currentInnings.totalWickets + (ball.isWicket ? 1 : 0),
          totalBalls: currentInnings.totalBalls + (!ball.isWide && !ball.isNoBall ? 1 : 0),
          extras: currentInnings.extras + (ball.isWide || ball.isNoBall ? ball.runs : 0),
          byes: currentInnings.byes + (ball.isBye ? ball.runs : 0),
          legByes: currentInnings.legByes + (ball.isLegBye ? ball.runs : 0),
          wides: currentInnings.wides + (ball.isWide ? 1 : 0),
          noBalls: currentInnings.noBalls + (ball.isNoBall ? 1 : 0),
          currentOver: newOver,
          currentBall: newBall,
          status: "in_progress",
          balls: newBalls,
        };

        // Update per-innings history with full state snapshots (O(1) undo/redo)
        const MAX_HISTORY = 50;
        const currentHistory = state[historyKey];
        let newHistory = currentHistory.history.slice(0, currentHistory.historyIndex + 1);
        // Seed initial empty state if history is empty so undo can revert to start
        if (newHistory.length === 0) {
          newHistory.push(currentInnings);
        }
        newHistory.push(updatedInnings);

        // Cap history to prevent memory leak
        if (newHistory.length > MAX_HISTORY) {
          newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
        }

        const update: Partial<ScoringState> = {
          [inningsKey]: updatedInnings,
          [historyKey]: {
            history: newHistory,
            historyIndex: newHistory.length - 1,
          },
        };

        set(update);
      },

      undo: () => {
        const state = get();
        const inningsKey = getInningsKey(state.currentInnings) as
          "innings1" | "innings2" | "superOver";
        const historyKey = getHistoryKey(state.currentInnings) as
          "innings1History" | "innings2History" | "superOverHistory";
        const currentHistory = state[historyKey];

        if (currentHistory.historyIndex <= 0) return;

        const newHistoryIndex = currentHistory.historyIndex - 1;
        const previousInnings = currentHistory.history[newHistoryIndex];

        const update: Partial<ScoringState> = {
          [inningsKey]: previousInnings,
          [historyKey]: {
            ...currentHistory,
            historyIndex: newHistoryIndex,
          },
        };

        set(update);
      },

      redo: () => {
        const state = get();
        const inningsKey = getInningsKey(state.currentInnings) as
          "innings1" | "innings2" | "superOver";
        const historyKey = getHistoryKey(state.currentInnings) as
          "innings1History" | "innings2History" | "superOverHistory";
        const currentHistory = state[historyKey];

        if (currentHistory.historyIndex >= currentHistory.history.length - 1) return;

        const newHistoryIndex = currentHistory.historyIndex + 1;
        const nextInnings = currentHistory.history[newHistoryIndex];

        const update: Partial<ScoringState> = {
          [inningsKey]: nextInnings,
          [historyKey]: {
            ...currentHistory,
            historyIndex: newHistoryIndex,
          },
        };

        set(update);
      },

      setOnline: (online: boolean) => set({ isOnline: online }),

      resetInnings: (innings) => {
        const state = get();
        const inningsKey = getInningsKey(innings) as
          "innings1" | "innings2" | "superOver";
        const historyKey = getHistoryKey(innings) as
          "innings1History" | "innings2History" | "superOverHistory";
        const currentInnings = state[inningsKey];

        if (currentInnings) {
          const resetInnings: InningsState = {
            ...currentInnings,
            totalRuns: 0,
            totalWickets: 0,
            totalBalls: 0,
            extras: 0,
            byes: 0,
            legByes: 0,
            wides: 0,
            noBalls: 0,
            status: "not_started",
            currentOver: 0,
            currentBall: 0,
            balls: [],
          };

          const update: Partial<ScoringState> = {
            [inningsKey]: resetInnings,
            [historyKey]: {
              history: [resetInnings],
              historyIndex: 0,
            },
          };

          set(update);
        }
      },
    }),
    {
      name: "scoring-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        matchId: state.matchId,
        currentInnings: state.currentInnings,
        innings1: state.innings1,
        innings2: state.innings2,
        superOver: state.superOver,
        innings1History: state.innings1History,
        innings2History: state.innings2History,
        superOverHistory: state.superOverHistory,
      }),
    }
  )
);

