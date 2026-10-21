import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useMatchStore } from "@/store/match-store";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";

/** Same presentation as the web's `formatNetRunRate`: explicit sign, 2dp. */
const formatNetRunRate = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

/**
 * ENH-03-03: the points table is served by `GET /api/mobile/standings` —
 * computed by the SHARED canonical rule v2 fold (2/1/0 points, balls-based
 * net run rate, forfeited/postponed/abandoned fixtures excluded from
 * "played" by the rule) and stamped with its `ruleVersion`. The device only
 * renders rows; it never re-derives standings from fixture rows, which is
 * how this screen used to drift from the web's points table.
 */
export default function StandingsScreen() {
  const { standings, standingsRuleVersion, fetchStandings, loading, error } =
    useMatchStore();
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchStandings();
    } finally {
      setRefreshing(false);
    }
  }, [fetchStandings]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading && !refreshing && standings.length === 0) {
    return <LoadingSpinner message="Loading standings..." />;
  }

  if (error && standings.length === 0) {
    return <ErrorView message={error} onRetry={() => loadData()} />;
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
          <Text style={styles.cell}>NRR</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={standings}
      keyExtractor={(item) => item.teamId}
      ListHeaderComponent={renderHeader}
      ListFooterComponent={
        standingsRuleVersion != null && standings.length > 0 ? (
          <Text style={styles.ruleFooter}>Rules v{standingsRuleVersion}</Text>
        ) : null
      }
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
          <Text style={[styles.cell, styles.teamCell]}>{row.name}</Text>
          <Text style={styles.cell}>{row.played}</Text>
          <Text style={styles.cell}>{row.won}</Text>
          <Text style={styles.cell}>{row.lost}</Text>
          <Text style={styles.cell}>{row.points}</Text>
          <Text style={styles.cell}>
            {row.hasNetRunRate ? formatNetRunRate(row.netRunRate) : "—"}
          </Text>
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
  ruleFooter: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 12,
    color: "#9ca3af",
  },
});
