import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import {
  resolveWicketFielderId,
  resolveWicketVictimId,
  victimOptionsFromParticipants,
  wicketFielderQuestion,
  wicketFielderRequirement,
} from "@mtk/contracts";
import { useMatchStore } from "@/store/match-store";
import { useOfflineStore, BallData } from "@/store/offline-store";
import { authedFetch, clerkConfigured } from "@/lib/app-api";

/**
 * SCORE-08 native scoring console. Deliveries can only be recorded by a
 * signed-in scorer, tied to a REAL innings id and NAMED batsman/bowler
 * hydrated from the authenticated web intake (the previous screen queued
 * anonymous balls with no identifiers — unsyncable by construction).
 * Every queue entry carries the recorder's account id (SCORE-09): another
 * signed-in account's work is quarantined, never adopted or synced.
 */

type ServerPlayer = { id: string; name: string; role: string | null; eligible?: boolean };
type PlayersResponse = { teamA: ServerPlayer[]; teamB: ServerPlayer[] };

interface MobileMatchState {
  queueScope: { accountId: string; tenantId: string; matchId: string };
  canScore: boolean;
  match: {
    id: string; status: string; scoringRevision?: number; handoverEpoch?: number;
    /** Batch 103: both sides identify the FIELDING squad for the
     *  wicket-attribution question (the innings carries the batting team). */
    teamAId: string; teamBId: string;
  };
  innings: Array<{
    id: string; inningsNumber: number; teamId: string; status?: string;
    totalRuns?: number; totalWickets?: number; totalBalls?: number;
  }>;
}

export default function MobileScoringScreen() {
  if (!clerkConfigured()) {
    return <Notice text="Sign-in is not configured in this build. Scoring writes are account-bound, so this console stays disabled until the app ships with sign-in." />;
  }
  return <AuthenticatedScoring />;
}

function AuthenticatedScoring() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const { currentMatch } = useMatchStore();
  // Mounted only inside ClerkProvider (gate above).
  const { isSignedIn, userId } = useAuth();
  const { addPendingBall, getPendingBalls, getConflictedBalls } = useOfflineStore();
  // Batch 102: the last service-confirmed crease per innings (captured from
  // record acknowledgements). OBSERVED canonical state only — never derived.
  const creaseByInnings = useOfflineStore((state) => state.creaseByInnings);

  const [hydrated, setHydrated] = useState<MobileMatchState | null>(null);
  const [players, setPlayers] = useState<PlayersResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  // Batch 102: a run-out may dismiss EITHER crease occupant. When the last
  // service-confirmed crease shows both occupants, the scorer is asked which
  // batter left (mirroring the web picker); otherwise the record is written
  // WITHOUT a victim id and the server fold default + self-heal applies.
  const [victimPick, setVictimPick] = useState<"run_out" | null>(null);
  // Batch 103: the fielder question (caught → catcher required by rule;
  // run_out/stumped → optional). Remembers the victim so a run-out asks
  // BOTH questions in one flow.
  const [fielderPick, setFielderPick] = useState<{ type: BallData["wicketType"]; victimId?: string } | null>(null);

  const [batsmanId, setBatsmanId] = useState("");
  const [bowlerId, setBowlerId] = useState("");
  const [pendingWicket, setPendingWicket] = useState(false);

  const loadState = useCallback(async () => {
    if (!isSignedIn || !matchId) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await authedFetch(`/api/mobile/scoring/state?matchId=${encodeURIComponent(matchId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Match state is unavailable");
      const serverState = body.state as MobileMatchState;
      if (serverState.queueScope.accountId !== userId) throw new Error("Scoring account changed");
      setHydrated(serverState);
      setPlayers(body.players as PlayersResponse);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Match state is unavailable");
      setHydrated(null);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, matchId, userId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const innings = hydrated?.innings[hydrated.innings.length - 1];
  const battingPlayers = useMemo(() => {
    if (!players) return [] as ServerPlayer[];
    // The innings row carries the batting team id; the scorer names the
    // actual striker and bowler from the eligible published squads.
    return [...players.teamA, ...players.teamB];
  }, [players]);
  // Batch 103: the FIELDING side - the dismissal credit belongs to the team
  // that is not batting this innings (the bowler is among them, so a
  // caught-and-bowled catcher remains a legitimate choice). No squad context
  // → no fielder question; the record is then written without fielder
  // attribution exactly as before Batch 103.
  const fielders = useMemo(() => {
    if (!players || !hydrated || !innings) return [] as ServerPlayer[];
    const fielding = innings.teamId === hydrated.match.teamAId
      ? players.teamB
      : innings.teamId === hydrated.match.teamBId ? players.teamA : [];
    return fielding;
  }, [players, hydrated, innings?.teamId]);

  if (isSignedIn === false) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Scoring requires a signed-in account.</Text>
        <Pressable style={styles.signInButton} onPress={() => router.push("/sign-in")}>
          <Text style={styles.signInText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }
  if (loading && !hydrated) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#16a34a" /></View>;
  }
  if (loadError !== "" || !hydrated || !players) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{loadError || "Match not found or loading..."}</Text>
        <Pressable style={styles.signInButton} onPress={() => void loadState()}>
          <Text style={styles.signInText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!hydrated.canScore) {
    return <Notice text="You are not currently authorized to score this match in this league." />;
  }
  if (!innings) {
    return <Notice text="Scoring opens when the match has a live innings recorded by the official scorer." />;
  }

  const conflicted = getConflictedBalls(matchId, userId);
  const pendingCount = getPendingBalls(matchId, userId).length;
  const overs = Math.floor((innings.totalBalls ?? 0) / 6);
  const ballThisOver = (innings.totalBalls ?? 0) % 6;
  // Batch 102: victim candidates come ONLY from the last service-confirmed
  // crease ack (the contracts policy refuses to guess from a rotation rule —
  // the server fold stays the only participant-derivation authority).
  const victimOptions = victimOptionsFromParticipants(creaseByInnings[innings.id]);
  const victimName = (id: string) =>
    battingPlayers.find((player) => player.id === id)?.name ?? "Unknown batter";

  const localRecord = (
    runType: { kind: "runs"; value: number } | { kind: "wicket" | "wide" | "noball" | "bye" | "legbye"; wicketType?: BallData["wicketType"]; wicketPlayerOutId?: BallData["wicketPlayerOutId"]; wicketFielderId?: string }
  ) => {
    if (!batsmanId || !bowlerId || !innings) {
      // The server refuses incomplete deliveries; do not queue what cannot
      // sync. The UI keeps the pickers visible instead.
      return;
    }
    if (runType.kind === "wicket" && !runType.wicketType) {
      setVictimPick(null); // fresh panel: never resurface a cancelled victim choice
      setFielderPick(null); // Batch 103: same rule for a cancelled fielder choice
      setPendingWicket(true); // the dismissal type is part of the official record - never guessed
      return;
    }
    // ENH-03-02 canonical queued semantics (validated by @mtk/contracts):
    // - a plain wide/no-ball/bye/leg-bye is worth exactly 1 and carries its
    //   extras flag, so the official record never invents batter runs or a
    //   legal ball out of a flat `runs: 1`;
    // - a wicket delivery scores 0 runs unless a richer control says
    //   otherwise (run-out + completed runs stay a web scoring-screen flow);
    // - batter runs obey the server's command ceiling (0..7 - the old grid
    //   offered 8, which the official record refuses as invalid_command and
    //   which then jammed the offline queue forever).
    const record: BallData = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      matchId: hydrated.match.id,
      inningsId: innings.id,
      innings: innings.inningsNumber,
      over: overs,
      ball: ballThisOver + 1,
      runs: runType.kind === "runs" ? runType.value : runType.kind === "wicket" ? 0 : 1,
      isWicket: runType.kind === "wicket",
      wicketType: runType.kind === "wicket" ? runType.wicketType : undefined,
      // Batch 102: the validated run-out victim (or nothing — the server
      // fold owns the striker default and self-heal whenever the recorded
      // choice cannot be re-validated against the confirmed candidates).
      wicketPlayerOutId: runType.kind === "wicket"
        ? resolveWicketVictimId({
            wicketType: runType.wicketType,
            options: victimOptions,
            chosenId: runType.wicketPlayerOutId,
          }) ?? undefined
        : undefined,
      // Batch 103: the validated dismissing fielder (or nothing — a skipped
      // optional question, an absent squad or a foreign id records WITHOUT
      // attribution; the canonical service re-validates the id against the
      // fielding XI regardless of what this device recorded).
      wicketFielderId: runType.kind === "wicket"
        ? resolveWicketFielderId({
            wicketType: runType.wicketType,
            options: fielders.map((fielder) => fielder.id),
            chosenId: runType.wicketFielderId,
          }) ?? undefined
        : undefined,
      isWide: runType.kind === "wide",
      isNoBall: runType.kind === "noball",
      isBye: runType.kind === "bye",
      isLegBye: runType.kind === "legbye",
      batsmanId,
      bowlerId,
      handoverEpoch: hydrated.match.handoverEpoch,
      expectedRevision: hydrated.match.scoringRevision,
      accountId: userId ?? "",
      timestamp: Date.now(),
      synced: false,
    };
    addPendingBall(record);
    void localRecordLabel(record, runType);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadState()} />}
    >
      <View style={styles.matchCard}>
        <Text style={styles.teamsText}>
          {currentMatch?.team1Name ?? "Match"} vs {currentMatch?.team2Name ?? ""}
        </Text>
        <Text style={styles.scoreText}>
          {innings.totalRuns ?? 0} / {innings.totalWickets ?? 0}
        </Text>
        <Text style={styles.oversText}>Overs: {overs}.{ballThisOver}</Text>
        <Text style={styles.syncLine}>
          Unsynchronised: {pendingCount}
          {conflicted.length > 0 ? ` · Conflicts needing review: ${conflicted.length}` : ""}
        </Text>
      </View>

      <Text style={styles.pickLabel}>Striker</Text>
      <PlayerPicker players={battingPlayers} value={batsmanId} onChange={setBatsmanId} />
      <Text style={styles.pickLabel}>Bowler (opposing side)</Text>
      <PlayerPicker players={battingPlayers} value={bowlerId} onChange={setBowlerId} />
      {(!batsmanId || !bowlerId) && (
        <Text style={styles.hintLine}>Name the striker and bowler first — deliveries without them cannot be accepted by the official record.</Text>
      )}

      <View style={styles.controlGrid}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.row}>
            {[0, 1, 2].map((col) => {
              // ENH-03-02: the server command ceiling is 7 (UI-8-vs-server-7
              // resolved) - the ninth cell renders as a spacer, never a
              // queueable 8-run delivery that the official record refuses.
              const value = row * 3 + col;
              if (value > 7) return <View key={col} style={styles.gridButton} />;
              return (
                <TouchableOpacity
                  key={col}
                  style={styles.gridButton}
                  disabled={!batsmanId || !bowlerId}
                  onPress={() => localRecord({ kind: "runs", value })}
                >
                  <Text style={styles.buttonText}>{value}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
        <View style={styles.row}>
          {(["wide", "noball", "bye", "legbye"] as const).map((kind) => (
            <TouchableOpacity
              key={kind}
              style={styles.gridButton}
              disabled={!batsmanId || !bowlerId}
              onPress={() => localRecord({ kind })}
            >
              <Text style={styles.buttonText}>
                {kind === "wide" ? "WD" : kind === "noball" ? "NB" : kind === "legbye" ? "LB" : "B"}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.gridButton, styles.wicketButtonBg]}
            disabled={!batsmanId || !bowlerId}
            onPress={() => localRecord({ kind: "wicket" })}
          >
            <Text style={[styles.buttonText, { color: "#fff" }]}>OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pendingWicket && (
        <View style={styles.wicketPanel}>
          {fielderPick ? (
            <>
              <Text style={styles.pickLabel}>
                {wicketFielderQuestion(fielderPick.type) ?? "Who dismissed the batter?"}
              </Text>
              {fielders.length === 0 ? (
                <Text style={styles.hintLine}>
                  No fielding squad published yet — the dismissal will be recorded without the fielder's name.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
                  {fielders.map((fielder) => (
                    <TouchableOpacity
                      key={fielder.id}
                      style={styles.chip}
                      onPress={() => {
                        setFielderPick(null);
                        setPendingWicket(false);
                        localRecord({
                          kind: "wicket",
                          wicketType: fielderPick.type,
                          wicketPlayerOutId: fielderPick.victimId,
                          wicketFielderId: fielder.id,
                        });
                      }}
                    >
                      <Text style={styles.chipText} numberOfLines={1}>{fielder.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {wicketFielderRequirement(fielderPick.type) === "optional" && (
                <TouchableOpacity
                  onPress={() => {
                    setFielderPick(null);
                    setPendingWicket(false);
                    localRecord({
                      kind: "wicket",
                      wicketType: fielderPick.type,
                      wicketPlayerOutId: fielderPick.victimId,
                    });
                  }}
                >
                  <Text style={styles.hintLine}>Record without fielder</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  // Back re-opens the dismissal-type question with no held
                  // choice: a fresh panel never resurfaces a cancelled pick.
                  setFielderPick(null);
                  setVictimPick(null);
                }}
              >
                <Text style={styles.hintLine}>Back</Text>
              </TouchableOpacity>
            </>
          ) : victimPick == null ? (
            <>
              <Text style={styles.pickLabel}>How was the batter out?</Text>
              <View style={styles.row}>
                {(["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket"] as const).map((kind) => (
                  <TouchableOpacity
                    key={kind}
                    style={styles.chip}
                    onPress={() => {
                      // Batch 102: a run-out can leave EITHER crease
                      // occupant. With a confirmed two-occupant crease the
                      // scorer names the batter who left (the striker
                      // default was silently wrong for off-strike
                      // run-outs); without one, record without attribution
                      // and the server fold default + self-heal applies.
                      if (kind === "run_out" && victimOptions.length === 2) {
                        setVictimPick(kind);
                        return;
                      }
                      // Batch 103: caught/run_out/stumped ask WHO dismissed
                      // the batter (from the fielding squad only); a skipped
                      // question records without attribution, never a guess.
                      if (wicketFielderRequirement(kind) !== "none" && fielders.length > 0) {
                        setVictimPick(null);
                        setFielderPick({ type: kind });
                        return;
                      }
                      setPendingWicket(false);
                      localRecord({ kind: "wicket", wicketType: kind });
                    }}
                  >
                    <Text style={styles.chipText}>{kind.replace("_", " ")}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => { setFielderPick(null); setVictimPick(null); setPendingWicket(false); }}>
                <Text style={styles.hintLine}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.pickLabel}>Which batter is out?</Text>
              {victimOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={styles.chip}
                  onPress={() => {
                    setVictimPick(null);
                    // Batch 103: after the victim, a caught/run_out/stumped
                    // dismissal may still ask for the dismissing fielder.
                    if (wicketFielderRequirement(victimPick) !== "none" && fielders.length > 0) {
                      setFielderPick({ type: victimPick, victimId: option.id });
                      return;
                    }
                    setPendingWicket(false);
                    localRecord({ kind: "wicket", wicketType: victimPick, wicketPlayerOutId: option.id });
                  }}
                >
                  <Text style={styles.chipText}>
                    {victimName(option.id)}{option.onStrike ? " (on strike)" : " (non-striker)"}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setVictimPick(null)}>
                <Text style={styles.hintLine}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {conflicted.length > 0 && (
        <Text style={styles.conflictText}>
          {conflicted.length} offline delivery hit a live-score change and is kept for review — nothing was overwritten.
        </Text>
      )}
    </ScrollView>
  );
}

function localRecordLabel(record: BallData, runType: { kind: string }): string {
  if (runType.kind === "wicket") return "W";
  if (runType.kind === "wide") return "WD";
  if (runType.kind === "noball") return "NB";
  return String(record.runs);
}

function PlayerPicker({ players, value, onChange }: {
  players: ServerPlayer[]; value: string; onChange: (id: string) => void;
}) {
  return (
    <ScrollView horizontal style={styles.pickerRow} showsHorizontalScrollIndicator={false}>
      {players.length === 0 && <Text style={styles.hintLine}>No eligible players published for this match yet.</Text>}
      {players.map((player) => (
        <TouchableOpacity
          key={player.id}
          onPress={() => onChange(player.id)}
          style={[styles.chip, value === player.id && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === player.id && styles.chipTextActive]} numberOfLines={1}>
            {player.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.centerContainer}>
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f6f7fb" },
  content: { padding: 16 },
  centerContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  errorText: { color: "#6b7280", fontSize: 16, textAlign: "center" },
  signInButton: { marginTop: 16, backgroundColor: "#16a34a", borderRadius: 12, paddingHorizontal: 24, height: 48, alignItems: "center", justifyContent: "center" },
  signInText: { color: "#fff", fontWeight: "bold" },
  matchCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", borderWidth: 1, borderColor: "#eef2f7", marginBottom: 20 },
  teamsText: { fontSize: 16, fontWeight: "600", color: "#4b5563", marginBottom: 10 },
  scoreText: { fontSize: 48, fontWeight: "bold", color: "#16a34a", marginVertical: 4 },
  oversText: { fontSize: 16, color: "#6b7280" },
  syncLine: { marginTop: 8, fontSize: 12, color: "#f59e0b", fontWeight: "600" },
  pickLabel: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 6 },
  pickerRow: { maxHeight: 48, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", marginRight: 8 },
  chipActive: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  chipText: { color: "#1f2937" },
  chipTextActive: { color: "#fff", fontWeight: "bold" },
  hintLine: { color: "#6b7280", fontSize: 12, marginBottom: 12 },
  controlGrid: { gap: 12, marginTop: 8, marginBottom: 20 },
  row: { flexDirection: "row", gap: 12 },
  gridButton: { flex: 1, height: 60, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e5e7eb" },
  wicketButtonBg: { backgroundColor: "#ef4444", borderColor: "#dc2626" },
  buttonText: { fontSize: 18, fontWeight: "bold", color: "#1f2937" },
  conflictText: { color: "#b45309", fontSize: 13, marginBottom: 24 },
  wicketPanel: { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#fde68a", marginBottom: 20 },
});
