import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";
import { useOfflineStore } from "@/store/offline-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Player {
  id: string;
  name: string;
  teamId?: string;
  teamName?: string;
  jerseyNumber?: number;
  role?: string;
  battingStyle?: string;
  bowlingStyle?: string;
}

interface PlayerStats {
  matches: number;
  runs: number;
  wickets: number;
  battingAverage: number;
  strikeRate: number;
  bowlingAverage: number;
  economy: number;
}

export default function PlayerScreen() {
  const { playerId } = useLocalSearchParams<{ playerId: string }>();
  const { t } = useTranslation();
  const [player, setPlayer] = useState<Player | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isOnline } = useOfflineStore();

  useEffect(() => {
    if (playerId) {
      fetchPlayer();
    }
  }, [playerId]);

  const fetchPlayer = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      
      if (isOnline) {
        // Fetch player data
        const { data: playerData, error: playerError } = await supabase
          .from("players")
          .select("*, teams(name)")
          .eq("id", playerId)
          .single();

        if (playerError) throw playerError;

        const p = {
          id: playerData.id,
          name: playerData.name,
          teamId: playerData.team_id,
          teamName: playerData.teams?.name,
          jerseyNumber: playerData.jersey_number,
          role: playerData.role,
          battingStyle: playerData.batting_style,
          bowlingStyle: playerData.bowling_style,
        };
        setPlayer(p);
        await AsyncStorage.setItem(`cached_player_${playerId}`, JSON.stringify(p));

        // Fetch player stats
        const { data: statsData, error: statsError } = await supabase
          .from("player_season_stats")
          .select("*")
          .eq("player_id", playerId);

        if (statsError) throw statsError;

        let matches = 0;
        let runs = 0;
        let wickets = 0;
        let ballsFaced = 0;
        let inningsBatted = 0;
        let notOuts = 0;
        let runsConceded = 0;
        let ballsBowled = 0;

        if (statsData && statsData.length > 0) {
          statsData.forEach((row: any) => {
            matches += row.matches_played || 0;
            runs += row.runs_scored || 0;
            wickets += row.wickets_taken || 0;
            ballsFaced += row.balls_faced || 0;
            inningsBatted += row.innings_batted || 0;
            notOuts += row.not_outs || 0;
            runsConceded += row.runs_conceded || 0;
            ballsBowled += row.balls_bowled || 0;
          });
        }

        // Calculate averages
        const inningsDismissed = inningsBatted - notOuts;
        const battingAverage = inningsDismissed > 0 ? runs / inningsDismissed : runs;
        const strikeRate = ballsFaced > 0 ? (runs / ballsFaced) * 100 : 0;
        
        const oversBowled = ballsBowled / 6;
        const economy = oversBowled > 0 ? runsConceded / oversBowled : 0;
        const bowlingAverage = wickets > 0 ? runsConceded / wickets : 0;

        const s = {
          matches,
          runs,
          wickets,
          battingAverage,
          strikeRate,
          bowlingAverage,
          economy,
        };
        setStats(s);
        await AsyncStorage.setItem(`cached_player_stats_${playerId}`, JSON.stringify(s));
      } else {
        const cachedP = await AsyncStorage.getItem(`cached_player_${playerId}`);
        const cachedS = await AsyncStorage.getItem(`cached_player_stats_${playerId}`);
        if (cachedP) {
          setPlayer(JSON.parse(cachedP));
        }
        if (cachedS) {
          setStats(JSON.parse(cachedS));
        }
      }
    } catch (e: any) {
      setErrorMessage(e.message || "Failed to load player.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading player details..." />;
  }

  if (!player) {
    return <ErrorView message={errorMessage || "Player not found"} onRetry={fetchPlayer} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Player Profile</Text>
        {player.teamName && <Text style={styles.heroSubtitle}>{player.teamName}</Text>}
      </View>

      {/* Player Header */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person" size={64} color="#16a34a" />
        </View>
        <Text style={styles.playerName}>{player.name}</Text>
        {player.teamName && (
          <Text style={styles.teamName}>{player.teamName}</Text>
        )}
        {player.jerseyNumber && (
          <Text style={styles.jerseyNumber}>#{player.jerseyNumber}</Text>
        )}
      </View>

      {/* Player Info */}
      <View style={styles.infoCard}>
        {player.role && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t("player.profile")}:</Text>
            <Text style={styles.infoValue}>{player.role}</Text>
          </View>
        )}
        {player.battingStyle && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Batting:</Text>
            <Text style={styles.infoValue}>{player.battingStyle}</Text>
          </View>
        )}
        {player.bowlingStyle && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Bowling:</Text>
            <Text style={styles.infoValue}>{player.bowlingStyle}</Text>
          </View>
        )}
      </View>

      {/* Statistics */}
      {stats && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>{t("player.stats")}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.matches}</Text>
              <Text style={styles.statLabel}>{t("player.matches")}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.runs}</Text>
              <Text style={styles.statLabel}>{t("player.runs")}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.wickets}</Text>
              <Text style={styles.statLabel}>{t("player.wickets")}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.battingAverage.toFixed(2)}</Text>
              <Text style={styles.statLabel}>{t("player.average")}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.strikeRate.toFixed(2)}</Text>
              <Text style={styles.statLabel}>{t("player.strikeRate")}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.economy.toFixed(2)}</Text>
              <Text style={styles.statLabel}>{t("player.economy")}</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  content: {
    paddingBottom: 24,
  },
  hero: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#dcfce7",
  },
  header: {
    backgroundColor: "#fff",
    padding: 24,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  avatarContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  playerName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 4,
  },
  teamName: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 4,
  },
  jerseyNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#16a34a",
  },
  infoCard: {
    backgroundColor: "#fff",
    margin: 16,
    padding: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
    width: 100,
  },
  infoValue: {
    fontSize: 14,
    color: "#111827",
    flex: 1,
  },
  statsCard: {
    backgroundColor: "#fff",
    margin: 16,
    padding: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  statItem: {
    width: "30%",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#16a34a",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
  loadingText: {
    textAlign: "center",
    color: "#6b7280",
    padding: 20,
    fontSize: 16,
  },
});

