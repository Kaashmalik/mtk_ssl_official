import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { Match } from "@/types";

interface MatchStore {
  matches: Match[];
  liveMatches: Match[];
  upcomingMatches: Match[];
  completedMatches: Match[];
  currentMatch: Match | null;
  loading: boolean;
  error: string | null;
  fetchMatches: (tenantId?: string) => Promise<void>;
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

      fetchMatches: async (tenantId?: string) => {
        set({ loading: true, error: null });
        try {
          let query = supabase
            .from("matches")
            .select("*")
            .order("scheduled_date", { ascending: false })
            .limit(50);

          if (tenantId) {
            query = query.eq("tenant_id", tenantId);
          }

          const { data, error } = await query;

          if (error) throw error;

          const matches = (data || []) as Match[];
          const live = matches.filter((m) => m.status === "live");
          const upcoming = matches.filter((m) => m.status === "scheduled");
          const completed = matches.filter((m) => m.status === "completed");

          set({
            matches,
            liveMatches: live,
            upcomingMatches: upcoming,
            completedMatches: completed,
            loading: false,
          });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchMatch: async (matchId: string) => {
        set({ loading: true, error: null });
        try {
          const { data, error } = await supabase
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .single();

          if (error) throw error;

          const match = data as Match;
          set({ currentMatch: match, loading: false });
          return match;
        } catch (error: any) {
          set({ error: error.message, loading: false });
          return null;
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
              const updatedMatch = payload.new as Match;
              set((state) => {
                const updatedMatches = state.matches.map((m) =>
                  m.id === matchId ? updatedMatch : m
                );
                const live = updatedMatches.filter((m) => m.status === "live");
                const upcoming = updatedMatches.filter((m) => m.status === "scheduled");
                const completed = updatedMatches.filter((m) => m.status === "completed");

                return {
                  matches: updatedMatches,
                  liveMatches: live,
                  upcomingMatches: upcoming,
                  completedMatches: completed,
                  currentMatch:
                    state.currentMatch?.id === matchId
                      ? updatedMatch
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
