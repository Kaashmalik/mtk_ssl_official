import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useMatchStore } from "@/store/match-store";
import type { Match } from "@/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";

interface StandingRow {
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  losses: number;
  points: number;
  runs: number;
  overs: number;
}

const buildStandings = (matches: Match[]): StandingRow[] => {
  const rows = new Map<string, StandingRow>();

  const ensureRow = (teamId: string, teamName: string) => {
    if (!rows.has(teamId)) {
      rows.set(teamId, {
        teamId,
        teamName,
        played: 0,
        wins: 0,
        losses: 0,
        points: 0,
        runs: 0,
        overs: 0,
      });
    }
    return rows.get(teamId)!;
  };

  matches.forEach((match) => {
    if (match.status !== "completed") return;

    const team1 = ensureRow(match.team1Id ?? "", match.team1Name ?? "");
    const team2 = ensureRow(match.team2Id ?? "", match.team2Name ?? "");

    team1.played += 1;
    team2.played += 1;

    if (match.team1Score !== undefined && match.team1Overs) {
      team1.runs += match.team1Score;
      team1.overs += parseFloat(match.team1Overs.toString()) || 0;
    }
    if (match.team2Score !== undefined && match.team2Overs) {
      team2.runs += match.team2Score;
      team2.overs += parseFloat(match.team2Overs.toString()) || 0;
    }

    if (match.winnerId) {
      if (match.winnerId === match.team1Id) {
        team1.wins += 1;
        team2.losses += 1;
        team1.points += 2;
      } else if (match.winnerId === match.team2Id) {
        team2.wins += 1;
        team1.losses += 1;
        team2.points += 2;
      }
    }
  });

  return Array.from(rows.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.wins - a.wins;
  });
};

const formatRR = (runs: number, overs: number) => {
  if (!overs) return "0.00";
  return (runs / overs).toFixed(2);
};

export default function StandingsScreen() {
  const { matches, fetchMatches, loading } = useMatchStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      await fetchMatches();
    } catch (e: any) {
      setError(e.message || "Failed to fetch standings");
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

  const standings = buildStandings(matches);

  if (loading && !refreshing) {
    return <LoadingSpinner message="Loading standings..." />;
  }

  if (error) {
    return <ErrorView message={error} onRetry={loadData} />;
  }

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Standings</Text>
        <Text style={styles.headerSubtitle}>Points table</Text>
      </View>
      {standings.length > 0 && (
        <View style={[styles.row, styles.headerRow]}>
          <Text style={[styles.cell, styles.teamCell]}>Team</Text>
          <Text style={styles.cell}>P</Text>
          <Text style={styles.cell}>W</Text>
          <Text style={styles.cell}>L</Text>
          <Text style={styles.cell}>Pts</Text>
          <Text style={styles.cell}>RR</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={standings}
      keyExtractor={(item) => item.teamId}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No standings available</Text>
        </View>
      }
      renderItem={({ item: row }) => (
        <View style={styles.row}>
          <Text style={[styles.cell, styles.teamCell]}>{row.teamName}</Text>
          <Text style={styles.cell}>{row.played}</Text>
          <Text style={styles.cell}>{row.wins}</Text>
          <Text style={styles.cell}>{row.losses}</Text>
          <Text style={styles.cell}>{row.points}</Text>
          <Text style={styles.cell}>{formatRR(row.runs, row.overs)}</Text>
        </View>
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
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    marginHorizontal: 16,
  },
  headerRow: {
    backgroundColor: "#f8fafc",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#cbd5e1",
    marginTop: 12,
  },
  cell: {
    width: 40,
    textAlign: "center",
    fontSize: 13,
    color: "#374151",
    fontWeight: "600",
  },
  teamCell: {
    flex: 1,
    width: "auto",
    textAlign: "left",
    fontSize: 14,
    fontWeight: "bold",
  },
});
