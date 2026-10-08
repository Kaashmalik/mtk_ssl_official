import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMatchStore } from "@/store/match-store";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";

export default function ResultsScreen() {
  const router = useRouter();
  const { completedMatches, fetchMatches, loading } = useMatchStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      await fetchMatches();
    } catch (e: any) {
      setError(e.message || "Failed to fetch results");
    } finally {
      setRefreshing(false);
    }
  }, [fetchMatches]);

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message="Loading results..." />;
  }

  if (error) {
    return <ErrorView message={error} onRetry={loadData} />;
  }

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Results</Text>
      <Text style={styles.headerSubtitle}>Completed matches and outcomes</Text>
    </View>
  );

  return (
    <FlatList
      data={completedMatches}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="trophy-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No results yet</Text>
        </View>
      }
      renderItem={({ item: match }) => (
        <TouchableOpacity
          style={styles.matchCard}
          onPress={() => router.push(`/match/${match.id}`)}
        >
          <View style={styles.matchHeader}>
            <Text style={styles.matchTitle}>
              {match.team1Name} vs {match.team2Name}
            </Text>
            {match.winnerId && (
              <Text style={styles.winnerText}>
                Winner: {match.winnerId === match.team1Id ? match.team1Name : match.team2Name}
              </Text>
            )}
          </View>
          {match.completedAt && (
            <Text style={styles.completedTime}>
              {new Date(match.completedAt).toLocaleString()}
            </Text>
          )}
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
  matchCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  matchHeader: {
    gap: 8,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  winnerText: {
    fontSize: 14,
    color: "#16a34a",
    fontWeight: "600",
  },
  completedTime: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
});
