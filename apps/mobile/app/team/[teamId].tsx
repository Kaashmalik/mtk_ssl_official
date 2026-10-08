import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";
import { useOfflineStore } from "@/store/offline-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Player {
  id: string;
  name: string;
  role: string | null;
  jerseyNumber: number | null;
}

interface Match {
  id: string;
  team1Id: string;
  team2Id: string;
  team1Name: string;
  team2Name: string;
  team1Score?: number;
  team2Score?: number;
  team1Wickets?: number;
  team2Wickets?: number;
  team1Overs?: string;
  team2Overs?: string;
  status: string;
  scheduledAt?: string;
  venue?: string;
  winnerId?: string | null;
}

interface TeamDetail {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

type SubTab = "roster" | "matches";

export default function TeamDetailScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const router = useRouter();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SubTab>("roster");
  const { isOnline } = useOfflineStore();

  const fetchData = useCallback(async () => {
    if (!teamId) return;
    try {
      setError(null);
      
      if (isOnline) {
        // 1. Fetch Team Details
        const { data: teamData, error: teamErr } = await supabase
          .from("teams")
          .select("id, name, short_name, logo_url")
          .eq("id", teamId)
          .single();

        if (teamErr) throw teamErr;
        const fetchedTeam = {
          id: teamData.id,
          name: teamData.name,
          shortName: teamData.short_name,
          logoUrl: teamData.logo_url,
        };
        setTeam(fetchedTeam);

        // 2. Fetch Players (Roster)
        const { data: playersData, error: playersErr } = await supabase
          .from("players")
          .select("id, name, role, jersey_number")
          .eq("team_id", teamId)
          .order("name", { ascending: true });

        if (playersErr) throw playersErr;
        const fetchedPlayers = (playersData || []).map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          jerseyNumber: p.jersey_number,
        }));
        setPlayers(fetchedPlayers);

        // 3. Fetch Matches
        const { data: matchesData, error: matchesErr } = await supabase
          .from("matches")
          .select(`
            id,
            team1_id,
            team2_id,
            team_a_id,
            team_b_id,
            status,
            winner_id,
            scheduled_date,
            scheduled_at,
            venue,
            team1_score,
            team2_score,
            team1_wickets,
            team2_wickets,
            team1_overs,
            team2_overs
          `)
          .or(`team1_id.eq.${teamId},team2_id.eq.${teamId},team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);

        if (matchesErr) throw matchesErr;

        const fetchedMatches = (matchesData || []).map((m: any) => ({
          id: m.id,
          team1Id: m.team1_id || m.team_a_id,
          team2Id: m.team2_id || m.team_b_id,
          team1Name: m.team1?.name || "Team A",
          team2Name: m.team2?.name || "Team B",
          team1Score: m.team1_score,
          team2Score: m.team2_score,
          team1Wickets: m.team1_wickets,
          team2Wickets: m.team2_wickets,
          team1Overs: m.team1_overs,
          team2Overs: m.team2_overs,
          status: m.status,
          scheduledDate: m.scheduled_date || m.scheduled_at,
          scheduledAt: m.scheduled_at || m.scheduled_date,
          venue: m.venue,
          winnerId: m.winner_id,
        }));
        setMatches(fetchedMatches);

        // Cache details
        await AsyncStorage.setItem(
          `cached_team_detail_${teamId}`,
          JSON.stringify({ team: fetchedTeam, players: fetchedPlayers, matches: fetchedMatches })
        );
      } else {
        const cached = await AsyncStorage.getItem(`cached_team_detail_${teamId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setTeam(parsed.team || null);
          setPlayers(parsed.players || []);
          setMatches(parsed.matches || []);
        }
      }

    } catch (e: any) {
      setError(e.message || "Failed to load team details");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teamId, isOnline]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return <LoadingSpinner message="Loading team details..." />;
  }

  if (error || !team) {
    return <ErrorView message={error || "Team not found"} onRetry={fetchData} />;
  }

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Ionicons name="shield" size={64} color="#16a34a" />
        </View>
        <Text style={styles.teamName}>{team.name}</Text>
        {team.shortName && <Text style={styles.teamShortName}>{team.shortName}</Text>}
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "roster" && styles.activeTab]}
          onPress={() => setActiveTab("roster")}
        >
          <Text style={[styles.tabText, activeTab === "roster" && styles.activeTabText]}>
            Roster ({players.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "matches" && styles.activeTab]}
          onPress={() => setActiveTab("matches")}
        >
          <Text style={[styles.tabText, activeTab === "matches" && styles.activeTabText]}>
            Matches ({matches.length})
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <FlatList<any>
      data={activeTab === "roster" ? players : matches}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.listContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons
            name={activeTab === "roster" ? "people-outline" : "calendar-outline"}
            size={48}
            color="#9ca3af"
          />
          <Text style={styles.emptyText}>
            {activeTab === "roster" ? "No players registered yet." : "No matches scheduled."}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        if (activeTab === "roster") {
          const player = item as Player;
          return (
            <TouchableOpacity
              style={styles.playerCard}
              onPress={() => router.push(`/player/${player.id}`)}
            >
              <View style={styles.playerInfo}>
                <View style={styles.avatarMini}>
                  <Ionicons name="person" size={18} color="#16a34a" />
                </View>
                <View>
                  <Text style={styles.playerName}>{player.name}</Text>
                  {player.role && <Text style={styles.playerRole}>{player.role}</Text>}
                </View>
              </View>
              {player.jerseyNumber && (
                <Text style={styles.jerseyNumber}>#{player.jerseyNumber}</Text>
              )}
            </TouchableOpacity>
          );
        } else {
          const match = item as Match;
          const isWinner = match.winnerId === teamId;
          const isLoser = match.winnerId && match.winnerId !== teamId;

          return (
            <TouchableOpacity
              style={styles.matchCard}
              onPress={() => router.push(`/match/${match.id}`)}
            >
              <View style={styles.matchHeader}>
                {match.status === "live" ? (
                  <View style={styles.liveBadge}>
                    <View style={styles.liveIndicator} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                ) : match.status === "completed" ? (
                  <View
                    style={[
                      styles.statusBadge,
                      isWinner && styles.winnerBadge,
                      isLoser && styles.loserBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        isWinner && styles.winnerBadgeText,
                        isLoser && styles.loserBadgeText,
                      ]}
                    >
                      {isWinner ? "WON" : isLoser ? "LOST" : "COMPLETED"}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.upcomingText}>UPCOMING</Text>
                )}
                {match.venue && (
                  <Text style={styles.venueText}>
                    <Ionicons name="location-outline" size={12} color="#6b7280" /> {match.venue}
                  </Text>
                )}
              </View>
              <View style={styles.matchTeams}>
                <View style={styles.teamRow}>
                  <Text style={[styles.matchTeamName, match.team1Id === teamId && styles.boldTeamName]}>
                    {match.team1Name}
                  </Text>
                  {match.team1Score !== undefined && (
                    <Text style={styles.matchScore}>
                      {match.team1Score}/{match.team1Wickets} ({match.team1Overs})
                    </Text>
                  )}
                </View>
                <View style={styles.teamRow}>
                  <Text style={[styles.matchTeamName, match.team2Id === teamId && styles.boldTeamName]}>
                    {match.team2Name}
                  </Text>
                  {match.team2Score !== undefined && (
                    <Text style={styles.matchScore}>
                      {match.team2Score}/{match.team2Wickets} ({match.team2Overs})
                    </Text>
                  )}
                </View>
              </View>
              {match.scheduledAt && match.status !== "live" && (
                <Text style={styles.scheduledTime}>
                  {new Date(match.scheduledAt).toLocaleString()}
                </Text>
              )}
            </TouchableOpacity>
          );
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  listContainer: {
    paddingBottom: 24,
    backgroundColor: "#f6f7fb",
  },
  header: {
    backgroundColor: "#fff",
    padding: 24,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginBottom: 16,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  teamName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 4,
  },
  teamShortName: {
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "600",
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: "#dcfce7",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  activeTabText: {
    color: "#16a34a",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 12,
  },
  playerCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 16,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#eef2f7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  playerInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarMini: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f0fdf4",
    alignItems: "center",
    justifyContent: "center",
  },
  playerName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  playerRole: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  jerseyNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: "#16a34a",
  },
  matchCard: {
    backgroundColor: "#fff",
    padding: 16,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  matchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  liveIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ef4444",
  },
  liveText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "bold",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#f3f4f6",
  },
  winnerBadge: {
    backgroundColor: "#dcfce7",
  },
  loserBadge: {
    backgroundColor: "#fee2e2",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#6b7280",
  },
  winnerBadgeText: {
    color: "#16a34a",
  },
  loserBadgeText: {
    color: "#ef4444",
  },
  upcomingText: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#16a34a",
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  venueText: {
    fontSize: 11,
    color: "#6b7280",
  },
  matchTeams: {
    gap: 8,
  },
  teamRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  matchTeamName: {
    fontSize: 14,
    color: "#4b5563",
  },
  boldTeamName: {
    fontWeight: "bold",
    color: "#111827",
  },
  matchScore: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#16a34a",
  },
  scheduledTime: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 8,
  },
});
