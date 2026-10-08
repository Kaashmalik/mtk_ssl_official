import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useMatchStore } from "@/store/match-store";
import { Ionicons } from "@expo/vector-icons";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";

type Tab = "live" | "upcoming" | "completed";

export default function MatchesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const { liveMatches, upcomingMatches, completedMatches, fetchMatches, loading } =
    useMatchStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      await fetchMatches();
    } catch (e: any) {
      setError(e.message || "Failed to fetch matches");
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

  const getMatchesForTab = () => {
    switch (activeTab) {
      case "live":
        return liveMatches;
      case "upcoming":
        return upcomingMatches;
      case "completed":
        return completedMatches;
    }
  };

  const matches = getMatchesForTab();

  if (loading && !refreshing) {
    return <LoadingSpinner message="Loading matches..." />;
  }

  if (error) {
    return <ErrorView message={error} onRetry={loadData} />;
  }

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("matches")}</Text>
        <Text style={styles.headerSubtitle}>Live, upcoming, and completed fixtures</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "live" && styles.activeTab]}
          onPress={() => setActiveTab("live")}
        >
          <Text
            style={[styles.tabText, activeTab === "live" && styles.activeTabText]}
          >
            {t("live")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "upcoming" && styles.activeTab]}
          onPress={() => setActiveTab("upcoming")}
        >
          <Text
            style={[styles.tabText, activeTab === "upcoming" && styles.activeTabText]}
          >
            {t("upcoming")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "completed" && styles.activeTab]}
          onPress={() => setActiveTab("completed")}
        >
          <Text
            style={[styles.tabText, activeTab === "completed" && styles.activeTabText]}
          >
            {t("completed")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <FlatList
      data={matches}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No matches found</Text>
        </View>
      }
      renderItem={({ item: match }) => (
        <TouchableOpacity
          style={styles.matchCard}
          onPress={() => router.push(`/match/${match.id}`)}
        >
          <View style={styles.matchHeader}>
            {match.status === "live" && (
              <View style={styles.liveBadge}>
                <View style={styles.liveIndicator} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
            {match.venue && (
              <Text style={styles.venueText}>
                <Ionicons name="location" size={14} color="#6b7280" /> {match.venue}
              </Text>
            )}
          </View>
          <View style={styles.teamsContainer}>
            <View style={styles.teamRow}>
              <Text style={styles.teamName}>{match.team1Name}</Text>
              {match.team1Score !== undefined && (
                <Text style={styles.score}>
                  {match.team1Score}/{match.team1Wickets} ({match.team1Overs})
                </Text>
              )}
            </View>
            <View style={styles.teamRow}>
              <Text style={styles.teamName}>{match.team2Name}</Text>
              {match.team2Score !== undefined && (
                <Text style={styles.score}>
                  {match.team2Score}/{match.team2Wickets} ({match.team2Overs})
                </Text>
              )}
            </View>
          </View>
          {(match.scheduledDate || match.scheduled_date || match.scheduledAt) && match.status !== "live" && (
            <Text style={styles.scheduledTime}>
              {new Date(match.scheduledDate || match.scheduled_date || match.scheduledAt!).toLocaleString()}
            </Text>
          )}
          {match.status === "completed" && match.winnerId && (
            <Text style={styles.winnerText}>
              Winner: {match.winnerId === match.team1Id ? match.team1Name : match.team2Name}
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
  tabs: {
    flexDirection: "row",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeTab: {
    borderBottomColor: "#16a34a",
  },
  tabText: {
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "500",
  },
  activeTabText: {
    color: "#16a34a",
    fontWeight: "bold",
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 4,
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
    fontSize: 12,
    fontWeight: "bold",
  },
  venueText: {
    fontSize: 12,
    color: "#6b7280",
  },
  teamsContainer: {
    gap: 12,
  },
  teamRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  teamName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  score: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#16a34a",
  },
  scheduledTime: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 8,
  },
  winnerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#16a34a",
    marginTop: 8,
  },
});
