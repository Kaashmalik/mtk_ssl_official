import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { appApiUrl, currentSessionToken } from "@/lib/app-api";
import {
  MOBILE_BFF_MAX_PAGE_SIZE,
  MOBILE_BFF_ROUTES,
  type MemberMatch,
  type MobileBffListResponse,
} from "@mtk/contracts";
import type { Match } from "@/types";

/**
 * ENH-03-03: THE native matches read goes through the authenticated web BFF
 * (`/api/mobile/matches`, Clerk bearer) - never direct database queries.
 * The server resolves the league from the session, returns the contracts
 * `MemberMatch` projection (complete 10-value status vocabulary) and cursor
 * pagination (a 60-fixture league pages; nothing truncates at a hard 50).
 *
 * `fetchMatches`/`fetchAllMatches`/`fetchMatch` resolve their own session
 * token, so screens keep their plain call signatures. A signed-out session
 * gets an explicit error instead of anonymous raw-row reads: without a
 * league there is nothing member-scoped to show.
 */

/** The one wire → screen adapter (screen shape stays stable across refactors). */
function memberMatchToMatch(m: MemberMatch): Match {
  return {
    id: m.id,
    tournamentId: m.tournamentId ?? undefined,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    team1Id: m.teamAId,
    team2Id: m.teamBId,
    team1Name: m.teamAName,
    team2Name: m.teamBName,
    status: m.status,
    // Screens historically read both casings; one wire date feeds all three.
    scheduledDate: m.scheduledDate ?? undefined,
    scheduled_date: m.scheduledDate ?? undefined,
    scheduledAt: m.scheduledDate ?? undefined,
    tossWinner: m.tossWinnerId ?? undefined,
    tossDecision: m.tossDecision ?? undefined,
    winnerId: m.winnerId ?? undefined,
    result: m.result ?? undefined,
    liveStreamUrl: m.liveStreamUrl,
    streamSource: m.streamSource,
    streamStatus: m.streamStatus,
    // ENH-08-03: single-read playback summary (live/replay/upcoming). The list
    // projection omits it, so the button keeps its legacy live fallback.
    playbackState: m.playback?.state,
    hasReplay: m.playback?.hasReplay,
  };
}

function bucket(matches: Match[]) {
  return {
    liveMatches: matches.filter((m) => m.status === "live"),
    upcomingMatches: matches.filter((m) => m.status === "scheduled"),
    completedMatches: matches.filter((m) => m.status === "completed"),
  };
}

type BffError = { error?: string; detail?: string };

async function fetchMatchPage(
  cursor: string | null,
  limit: number,
  token: string,
): Promise<MobileBffListResponse<MemberMatch>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${appApiUrl()}${MOBILE_BFF_ROUTES.matches}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("Session expired - sign in again to load matches");
  if (res.status === 403) throw new Error("No active league for this account");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as BffError;
    throw new Error(body.detail || body.error || `Matches request failed (HTTP ${res.status})`);
  }
  return (await res.json()) as MobileBffListResponse<MemberMatch>;
}

interface MatchStore {
  matches: Match[];
  liveMatches: Match[];
  upcomingMatches: Match[];
  completedMatches: Match[];
  currentMatch: Match | null;
  loading: boolean;
  error: string | null;
  /** Opaque continuation cursor for the paged list (null = exhausted). */
  nextCursor: string | null;
  hasMore: boolean;
  /** One page (up to the BFF's 50 ceiling) - home/matches tabs. */
  fetchMatches: () => Promise<void>;
  /** Pages through the WHOLE league list - standings must never be partial. */
  fetchAllMatches: () => Promise<void>;
  /** Continues the paged list (matches tab "load more"). */
  fetchNextMatches: () => Promise<void>;
  fetchMatch: (matchId: string) => Promise<Match | null>;
  setCurrentMatch: (match: Match | null) => void;
  subscribeToMatch: (matchId: string) => () => void;
}

export const useMatchStore = create<MatchStore>()(
  persist(
    (set, _get) => ({
      matches: [],
      liveMatches: [],
      upcomingMatches: [],
      completedMatches: [],
      currentMatch: null,
      loading: false,
      error: null,
      nextCursor: null,
      hasMore: false,

      fetchMatches: async () => {
        set({ loading: true, error: null });
        try {
          const token = await currentSessionToken();
          if (!token) {
            set({ error: "Sign in to load your league's matches", loading: false });
            return;
          }
          const page = await fetchMatchPage(null, MOBILE_BFF_MAX_PAGE_SIZE, token);
          const matches = page.items.map(memberMatchToMatch);
          set({
            matches,
            ...bucket(matches),
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== null,
            loading: false,
          });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchAllMatches: async () => {
        set({ loading: true, error: null });
        try {
          const token = await currentSessionToken();
          if (!token) {
            set({ error: "Sign in to load your league's matches", loading: false });
            return;
          }
          // Standings computed from a truncated list are WRONG standings -
          // page to exhaustion (safety-capped; even a 500-match league is
          // 10 pages and the cursor contract, not a counter, ends the loop).
          const acc: Match[] = [];
          const seen = new Set<string>();
          let cursor: string | null = null;
          for (let page_ = 0; page_ < 20; page_++) {
            const page = await fetchMatchPage(cursor, MOBILE_BFF_MAX_PAGE_SIZE, token);
            for (const item of page.items) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                acc.push(memberMatchToMatch(item));
              }
            }
            cursor = page.nextCursor;
            if (!cursor) break;
          }
          if (cursor) {
            // The safety cap tripped before the cursor contract ended the
            // list - surface it rather than shipping silent partial standings.
            set({ error: "League too large to load standings - contact support", loading: false });
            return;
          }
          set({ matches: acc, ...bucket(acc), nextCursor: null, hasMore: false, loading: false });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchNextMatches: async () => {
        const { nextCursor } = _get();
        if (!nextCursor) return;
        set({ loading: true, error: null });
        try {
          const token = await currentSessionToken();
          if (!token) {
            set({ error: "Sign in to load your league's matches", loading: false });
            return;
          }
          const page = await fetchMatchPage(nextCursor, MOBILE_BFF_MAX_PAGE_SIZE, token);
          set((state) => {
            const known = new Set(state.matches.map((m) => m.id));
            const merged = [...state.matches];
            for (const item of page.items) {
              if (!known.has(item.id)) merged.push(memberMatchToMatch(item));
            }
            return {
              matches: merged,
              ...bucket(merged),
              nextCursor: page.nextCursor,
              hasMore: page.nextCursor !== null,
              loading: false,
            };
          });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchMatch: async (matchId: string) => {
        set({ loading: true, error: null });
        try {
          const token = await currentSessionToken();
          if (!token) {
            set({ error: "Sign in to load your league's matches", loading: false });
            return null;
          }
          const res = await fetch(
            `${appApiUrl()}${MOBILE_BFF_ROUTES.matches}?matchId=${encodeURIComponent(matchId)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.status === 401) throw new Error("Session expired - sign in again to load matches");
          if (res.status === 403) throw new Error("No active league for this account");
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as BffError;
            throw new Error(body.detail || body.error || `Match request failed (HTTP ${res.status})`);
          }
          const page = (await res.json()) as MobileBffListResponse<MemberMatch>;
          const match = page.items.length > 0 ? memberMatchToMatch(page.items[0]) : null;
          set({ currentMatch: match, loading: false });
          return match;
        } catch (error: any) {
          set({ error: error.message, loading: false });
          return null;
        }
      },

      setCurrentMatch: (match) => set({ currentMatch: match }),

      subscribeToMatch: (matchId: string) => {
        // Batch 176: the read path is THE authenticated BFF - the previous
        // Supabase realtime subscription was a bare-anon postgres_changes
        // read (the exact pattern ENH-03-03 retired): it forced the matches
        // table to be anon-readable and carried the raw snake_case row to
        // the client anyway. Same contract, honest transport: poll the same
        // `?matchId=` route fetchMatch uses, apply ONLY the status (the
        // canonical projection still arrives through fetchMatch on focus
        // and pull-to-refresh), and never surface transport noise - a failed
        // or signed-out tick is silent by design so it cannot clobber a
        // canonical fetch's loading/error flags.
        let cancelled = false;
        const poll = async () => {
          try {
            const token = await currentSessionToken();
            if (!token || cancelled) return;
            const res = await fetch(
              `${appApiUrl()}${MOBILE_BFF_ROUTES.matches}?matchId=${encodeURIComponent(matchId)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (cancelled || !res.ok) return;
            const page = (await res.json()) as MobileBffListResponse<MemberMatch>;
            const status = page.items[0]?.status;
            if (!status) return;
            set((state) => {
              // Same status-only patch semantics as the realtime handler it
              // replaces: id and status from the wire, everything else waits.
              const updatedMatches = state.matches.map((m) =>
                m.id === matchId ? { ...m, status } : m
              );
              return {
                matches: updatedMatches,
                ...bucket(updatedMatches),
                currentMatch:
                  state.currentMatch?.id === matchId
                    ? { ...state.currentMatch, status }
                    : state.currentMatch,
              };
            });
          } catch {
            // Silent by design: transport hiccups must not become UI errors.
          }
        };
        void poll();
        const timer = setInterval(poll, 20_000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      },
    }),
    {
      name: "matches-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data lists, not loading/error flags
      partialize: (state) => ({
        matches: state.matches,
        liveMatches: state.liveMatches,
        upcomingMatches: state.upcomingMatches,
        completedMatches: state.completedMatches,
        currentMatch: state.currentMatch,
      }),
    }
  )
);
