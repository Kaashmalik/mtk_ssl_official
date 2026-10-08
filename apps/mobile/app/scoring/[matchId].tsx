import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMatchStore } from "@/store/match-store";
import { useOfflineStore, BallData } from "@/store/offline-store";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export default function MobileScoringScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const { currentMatch, fetchMatch } = useMatchStore();
  const { isOnline, addPendingBall, getPendingBalls } = useOfflineStore();

  // Run the offline sync hook
  useOfflineSync();

  const [runs, setRuns] = useState(0);
  const [wickets, setWickets] = useState(0);
  const [overs, setOvers] = useState(0);
  const [balls, setBalls] = useState(0);
  const [currentOverBalls, setCurrentOverBalls] = useState<string[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (matchId) {
      fetchMatch(matchId);
    }
  }, [matchId]);

  if (!currentMatch) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Match not found or loading...</Text>
      </View>
    );
  }

  const recordBall = (type: "dot" | "run" | "wicket" | "wide" | "noball", value = 0) => {
    let ballRuns = 0;
    let isWk = false;
    let label = ".";

    if (type === "run") {
      ballRuns = value;
      label = value.toString();
    } else if (type === "wicket") {
      isWk = true;
      label = "W";
    } else if (type === "wide") {
      ballRuns = 1;
      label = "WD";
    } else if (type === "noball") {
      ballRuns = 1;
      label = "NB";
    }

    const nextBalls = balls + (type === "wide" || type === "noball" ? 0 : 1);
    const nextOvers = nextBalls === 6 ? overs + 1 : overs;
    const nextBallsCount = nextBalls === 6 ? 0 : nextBalls;

    // Update state
    setRuns((prev) => prev + ballRuns + (type === "wicket" ? 0 : 0));
    if (isWk) setWickets((prev) => prev + 1);
    setOvers(nextOvers);
    setBalls(nextBallsCount);
    setCurrentOverBalls((prev) => [...prev, label]);

    // Save history for local undo
    setHistory((prev) => [
      ...prev,
      {
        runs: ballRuns,
        isWicket: isWk,
        overs,
        balls,
        currentOverBalls,
      },
    ]);

    // Save to offline queue
    const ballRecord: BallData = {
      id: Math.random().toString(36).substring(7),
      matchId: matchId || "",
      innings: 1,
      over: overs,
      ball: balls + 1,
      runs: ballRuns,
      isWicket: isWk,
      timestamp: Date.now(),
      synced: false,
    };

    addPendingBall(ballRecord);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setRuns((prev) => Math.max(0, prev - last.runs));
    if (last.isWicket) setWickets((prev) => Math.max(0, prev - 1));
    setOvers(last.overs);
    setBalls(last.balls);
    setCurrentOverBalls(last.currentOverBalls);
    setHistory((prev) => prev.slice(0, -1));
  };

  const pendingCount = getPendingBalls(matchId).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mobile Scoring Console</Text>
        <View style={styles.statusContainer}>
          <Ionicons
            name={isOnline ? "cloud-done" : "cloud-offline"}
            size={22}
            color={isOnline ? "#10b981" : "#f59e0b"}
          />
          {pendingCount > 0 && (
            <Text style={styles.pendingText}>{pendingCount} unsynced</Text>
          )}
        </View>
      </View>

      {/* Match Info */}
      <View style={styles.matchCard}>
        <Text style={styles.teamsText}>
          {currentMatch.team1Name} vs {currentMatch.team2Name}
        </Text>
        <Text style={styles.scoreText}>
          {runs} / {wickets}
        </Text>
        <Text style={styles.oversText}>
          Overs: {overs}.{balls}
        </Text>
      </View>

      {/* Current Over Bubbles */}
      <View style={styles.overSection}>
        <Text style={styles.sectionLabel}>This Over:</Text>
        <View style={styles.bubblesContainer}>
          {currentOverBalls.map((b, i) => (
            <View
              key={i}
              style={[
                styles.bubble,
                b === "W"
                  ? styles.wicketBubble
                  : b === "WD" || b === "NB"
                  ? styles.extraBubble
                  : styles.dotBubble,
              ]}
            >
              <Text style={styles.bubbleText}>{b}</Text>
            </View>
          ))}
          {currentOverBalls.length === 0 && (
            <Text style={styles.emptyOverText}>Over starting...</Text>
          )}
        </View>
      </View>

      {/* Button Grid */}
      <View style={styles.controlGrid}>
        <View style={styles.row}>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("dot")}>
            <Text style={styles.buttonText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("run", 1)}>
            <Text style={styles.buttonText}>1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("run", 2)}>
            <Text style={styles.buttonText}>2</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("run", 3)}>
            <Text style={styles.buttonText}>3</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("run", 4)}>
            <Text style={styles.buttonText}>4</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridButton} onPress={() => recordBall("run", 6)}>
            <Text style={styles.buttonText}>6</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.gridButton, styles.wideButton]}
            onPress={() => recordBall("wide")}
          >
            <Text style={styles.buttonText}>WD</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.gridButton, styles.noBallButton]}
            onPress={() => recordBall("noball")}
          >
            <Text style={styles.buttonText}>NB</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.gridButton, styles.wicketButtonBg]}
            onPress={() => recordBall("wicket")}
          >
            <Text style={[styles.buttonText, { color: "#fff" }]}>OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Undo Button */}
      <TouchableOpacity
        style={[styles.undoButton, history.length === 0 && styles.disabledButton]}
        disabled={history.length === 0}
        onPress={handleUndo}
      >
        <Ionicons name="refresh" size={20} color="#fff" />
        <Text style={styles.undoText}>Undo Last Ball</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  content: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  errorText: {
    color: "#6b7280",
    fontSize: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: Platform.OS === "ios" ? 40 : 10,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#111827",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pendingText: {
    fontSize: 12,
    color: "#f59e0b",
    fontWeight: "600",
  },
  matchCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eef2f7",
    marginBottom: 20,
  },
  teamsText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 10,
  },
  scoreText: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#16a34a",
    marginVertical: 4,
  },
  oversText: {
    fontSize: 16,
    color: "#6b7280",
  },
  overSection: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderColor: "#eef2f7",
    borderWidth: 1,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  bubblesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dotBubble: {
    backgroundColor: "#f3f4f6",
  },
  wicketBubble: {
    backgroundColor: "#ef4444",
  },
  extraBubble: {
    backgroundColor: "#fef3c7",
  },
  bubbleText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#111827",
  },
  emptyOverText: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  controlGrid: {
    gap: 12,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  gridButton: {
    flex: 1,
    height: 60,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  wideButton: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  noBallButton: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  wicketButtonBg: {
    backgroundColor: "#ef4444",
    borderColor: "#dc2626",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1f2937",
  },
  undoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#4b5563",
    height: 50,
    borderRadius: 12,
  },
  disabledButton: {
    backgroundColor: "#d1d5db",
  },
  undoText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
