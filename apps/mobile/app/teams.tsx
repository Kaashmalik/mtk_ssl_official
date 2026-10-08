import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";
import { useOfflineStore } from "@/store/offline-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Team {
  id: string;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
}

export default function TeamsScreen() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useOfflineStore();

  const fetchTeams = useCallback(async () => {
    try {
      setError(null);
      if (isOnline) {
        const { data, error: fetchError } = await supabase
          .from("teams")
          .select("id, name, shortName:short_name, logoUrl:logo_url")
          .order("name", { ascending: true });

        if (fetchError) throw fetchError;
        const mapped = (data || []) as Team[];
        setTeams(mapped);
        await AsyncStorage.setItem("cached_teams", JSON.stringify(mapped));
      } else {
        const cached = await AsyncStorage.getItem("cached_teams");
        if (cached) {
          setTeams(JSON.parse(cached));
        } else {
          setTeams([]);
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to fetch teams");
      setTeams([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline]);

  useEffect(() => {
    setLoading(true);
    fetchTeams();
  }, [fetchTeams]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTeams();
  };

  if (loading) {
    return <LoadingSpinner message="Loading teams..." />;
  }

  if (error && teams.length === 0) {
    return <ErrorView message={error} onRetry={fetchTeams} />;
  }

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Teams</Text>
      <Text style={styles.headerSubtitle}>Browse teams and squads</Text>
    </View>
  );

  return (
    <FlatList
      data={teams}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="shield-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No teams found</Text>
        </View>
      }
      renderItem={({ item: team }) => (
        <TouchableOpacity
          style={styles.teamCard}
          onPress={() => router.push(`/team/${team.id}`)}
        >
          <View style={styles.teamInfo}>
            <Ionicons name="shield" size={20} color="#16a34a" />
            <View>
              <Text style={styles.teamName}>{team.name}</Text>
              {team.shortName && (
                <Text style={styles.teamMeta}>{team.shortName}</Text>
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
  teamCard: {
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
  teamInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  teamName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  teamMeta: {
    fontSize: 12,
    color: "#6b7280",
  },
});
