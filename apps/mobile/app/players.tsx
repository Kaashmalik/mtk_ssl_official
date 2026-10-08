import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";
import { useOfflineStore } from "@/store/offline-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface PlayerListItem {
  id: string;
  name: string;
  teamName?: string | null;
  role?: string | null;
}

export default function PlayersScreen() {
  const router = useRouter();
  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useOfflineStore();

  const fetchPlayers = useCallback(async () => {
    try {
      setError(null);
      if (isOnline) {
        const { data, error: fetchError } = await supabase
          .from("players")
          .select("id, name, role, teams(name)")
          .order("name", { ascending: true });

        if (fetchError) throw fetchError;

        const mapped = (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          role: item.role,
          teamName: item.teams?.name,
        }));

        setPlayers(mapped);
        await AsyncStorage.setItem("cached_players", JSON.stringify(mapped));
      } else {
        const cached = await AsyncStorage.getItem("cached_players");
        if (cached) {
          setPlayers(JSON.parse(cached));
        } else {
          setPlayers([]);
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to fetch players");
      setPlayers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline]);

  useEffect(() => {
    setLoading(true);
    fetchPlayers();
  }, [fetchPlayers]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPlayers();
  };

  if (loading) {
    return <LoadingSpinner message="Loading players..." />;
  }

  if (error && players.length === 0) {
    return <ErrorView message={error} onRetry={fetchPlayers} />;
  }

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Players</Text>
      <Text style={styles.headerSubtitle}>Browse player profiles</Text>
    </View>
  );

  return (
    <FlatList
      data={players}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No players found</Text>
        </View>
      }
      renderItem={({ item: player }) => (
        <TouchableOpacity
          style={styles.playerCard}
          onPress={() => router.push(`/player/${player.id}`)}
        >
          <View style={styles.playerInfo}>
            <Ionicons name="person" size={20} color="#16a34a" />
            <View>
              <Text style={styles.playerName}>{player.name}</Text>
              {player.teamName && (
                <Text style={styles.playerMeta}>{player.teamName}</Text>
              )}
              {player.role && (
                <Text style={styles.playerMeta}>{player.role}</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
    backgroundColor: "#f6f7fb",
  },
  header: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#dcfce7",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#6b7280",
    marginTop: 16,
  },
  playerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  playerInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playerName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  playerMeta: {
    fontSize: 12,
    color: "#6b7280",
  },
});
