import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/app-api";
import {
  MATCH_STATUSES,
  bucketMobileFixtures,
  parseMobileFixturePage,
} from "@mtk/contracts";
import type { StandingRowV1, Match } from "@/types";

/**
 * ENH-03-03: the device reads the league EXCLUSIVELY through the mobile BFF
 * (`/api/mobile/<resource>` — Clerk session, server-side tenant, contracts
 * envelope), never through raw Supabase rows. Raw rows are how native ended
 * up with fabricated team names, truncated 50-row lists and silently missing
 * statuses (postponed/forfeited were not even in the old union). The BFF's
 * strict `MobileFixtureV1` projection and keyset pagination make truncation,
 * wrong names and stale statuses unreachable by construction.
 *
 * Tenant scope: the BFF resolves the active league SERVER-SIDE and stamps it
 * on the `x-mtk-tenant` response header. The store keeps that scope; the
 * persisted cache carries it too, so a league switch replaces the world
 * instead of merging two leagues' fixtures.
 */

interface MatchStore {
  matches: Match[];
  liveMatches: Match[];
  upcomingMatches: Match[];
  completedMatches: Match[];
  currentMatch: Match | null;
  standings: StandingRowV1[];
  standingsRuleVersion: number | null;
  /** The league (tenant) the cached lists belong to, from x-mtk-tenant. */
  tenantScope: string | null;
  loading: boolean;
  error: string | null;
  /** `tenantId` is accepted (and ignored) for call-site compatibility: the
   *  BFF resolves the tenant from the session, never from the client. */
  fetchMatches: (tenantId?: string) => Promise<void>;
  fetchMatch: (matchId: string) => Promise<Match | null>;
  fetchStandings: (tournamentId?: string) => Promise<void>;
  setCurrentMatch: (match: Match | null) => void;
  subscribeToMatch: (matchId: string) => () => void;
}

async function readEnvelopeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

/** Follows the keyset pagination to the end: a league with 50+ fixtures must
 *  arrive complete, never truncated at a page boundary. */
async function readAllFixtures(): Promise<{ fixtures: Match[]; tenantId: string | null }> {
  const fixtures: Match[] = [];
  let tenantId: string | null = null;
  let cursor: string | null = null;
  // A defensive cap far above any real league size; the keyset loop itself
  // terminates when the BFF stops issuing cursors.
  for (let page = 0; page < 200; page += 1) {
    const path = cursor ? `fixtures?cursor=${encodeURIComponent(cursor)}` : "fixtures";
    const response = await authedFetch(path);
    if (!response.ok) throw new Error(await readEnvelopeError(response));
    tenantId = response.headers.get("x-mtk-tenant") ?? tenantId;
    const parsed = parseMobileFixturePage(await response.json());
    fixtures.push(...parsed.items);
    if (!parsed.nextCursor) break;
    cursor = parsed.nextCursor;
  }
  return { fixtures, tenantId };
}

export const useMatchStore = create<MatchStore>()(
  persist(
    (set, _get) => ({
      matches: [],
      liveMatches: [],
      upcomingMatches: [],
      completedMatches: [],
      currentMatch: null,
      standings: [],
      standingsRuleVersion: null,
      tenantScope: null,
      loading: false,
      error: null,

      fetchMatches: async () => {
        set({ loading: true, error: null });
        try {
          const { fixtures, tenantId } = await readAllFixtures();
          const buckets = bucketMobileFixtures(fixtures);
          set({
            matches: fixtures,
            liveMatches: buckets.live,
            upcomingMatches: buckets.upcoming,
            completedMatches: buckets.completed,
            tenantScope: tenantId,
            loading: false,
          });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchMatch: async (matchId: string) => {
        set({ loading: true, error: null });
        try {
          const response = await authedFetch(`fixtures/${matchId}`);
          if (!response.ok) throw new Error(await readEnvelopeError(response));
          // One fixture is validated through the SAME strict projection as a
          // page — a single read is never looser than the paginated feed.
          const [match] = parseMobileFixturePage({
            items: [await response.json()],
            nextCursor: null,
            revision: 1,
          }).items;
          set({ currentMatch: match, loading: false });
          return match;
        } catch (error: any) {
          set({ error: error.message, loading: false });
          return null;
        }
      },

      fetchStandings: async (tournamentId?: string) => {
        set({ loading: true, error: null });
        try {
          const path = tournamentId ? `standings?tournamentId=${encodeURIComponent(tournamentId)}` : "standings";
          const response = await authedFetch(path);
          if (!response.ok) throw new Error(await readEnvelopeError(response));
          const body = (await response.json()) as {
            ruleVersion?: unknown;
            rows?: unknown;
          };
          if (typeof body.ruleVersion !== "number" || !Array.isArray(body.rows)) {
            throw new Error("The standings response is not a rule-versioned table");
          }
          set({
            standings: body.rows as StandingRowV1[],
            standingsRuleVersion: body.ruleVersion,
            loading: false,
          });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      setCurrentMatch: (match) => set({ currentMatch: match }),

      subscribeToMatch: (matchId: string) => {
        const channel = supabase
          .channel(`match:${matchId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "matches",
              filter: `id=eq.${matchId}`,
            },
            (payload) => {
              // The realtime payload is a RAW database row — no resolved
              // names, non-canonical columns — so it is never cast into the
              // canonical projection. Only its status update is applied, to
              // a fixture the BFF already delivered; anything more (scores,
              // names) must come from a refetch through the BFF.
              const raw = payload.new as { id?: unknown; status?: unknown } | null;
              if (!raw || raw.id !== matchId || typeof raw.status !== "string") return;
              if (!(MATCH_STATUSES as readonly string[]).includes(raw.status)) return;
              const status = raw.status as Match["status"];
              set((state) => {
                const matches = state.matches.map((m) =>
                  m.id === matchId ? { ...m, status } : m
                );
                const buckets = bucketMobileFixtures(matches);
                return {
                  matches,
                  liveMatches: buckets.live,
                  upcomingMatches: buckets.upcoming,
                  completedMatches: buckets.completed,
                  currentMatch:
                    state.currentMatch?.id === matchId
                      ? { ...state.currentMatch, status }
                      : state.currentMatch,
                };
              });
            }
          )
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
        };
      },
    }),
    {
      name: "matches-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data lists and their league scope, not loading/error flags
      partialize: (state) => ({
        matches: state.matches,
        liveMatches: state.liveMatches,
        upcomingMatches: state.upcomingMatches,
        completedMatches: state.completedMatches,
        currentMatch: state.currentMatch,
        standings: state.standings,
        standingsRuleVersion: state.standingsRuleVersion,
        tenantScope: state.tenantScope,
      }),
    }
  )
);
