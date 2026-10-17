"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { useScoringStore, BallInput, type InningsState } from "@/stores/scoring-store";
import { BallInputComponent } from "@/components/scoring/ball-input";
import { LiveScorecard } from "@/components/scoring/live-scorecard";
import { DLSCalculator } from "@/components/scoring/dls-calculator";
import { PlayerSelector } from "@/components/scoring/player-selector";
import { VoiceInput } from "@/components/scoring/voice-input";
import dynamic from "next/dynamic";
import { Skeleton } from "@mtk/ui/components/ui/skeleton";

const ChartFallback = () => <Skeleton className="h-72 w-full rounded-xl" />;

const ManhattanChart = dynamic(
  () => import("@/components/scoring/manhattan-chart").then((m) => m.ManhattanChart),
  { ssr: false, loading: ChartFallback }
);
const WagonWheel = dynamic(
  () => import("@/components/scoring/wagon-wheel").then((m) => m.WagonWheel),
  { ssr: false, loading: ChartFallback }
);
const WormChart = dynamic(
  () => import("@/components/scoring/worm-chart").then((m) => m.WormChart),
  { ssr: false, loading: ChartFallback }
);
import { Button } from "@mtk/ui";
import { Card } from "@mtk/ui";
import { Undo2, Redo2, Wifi, WifiOff, Zap, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  recordBall as recordBallAction,
  undoBall as undoBallAction,
  getMatchForScoring,
  createInnings,
  completeInnings as completeInningsAction,
  getMatchPlayersForScoring,
  type RecordBallInput,
} from "@/app/actions/scoring";
import { useScoringSocket } from "@/hooks/use-scoring-socket";
import { CommentaryFeed } from "@/components/scoring/commentary-feed";
import { LanguageSelector } from "@/components/scoring/language-selector";
import { queueBall, removeQueuedBall } from "@/lib/offline-ball-queue";
import { resolveActionError } from "@/lib/plan-limit-error";
import { scoringWriteConflictMessage, HANDOVER_RESYNC_COPY, unwrapScoringFenceResult } from "@/lib/scoring-fence";
import { pendingDeliveryRevision } from "@/lib/scoring-recovery";
import { ScoringRecoveryPanel } from "@/components/scoring/scoring-recovery-panel";
import { useOfflineBallSync } from "@/hooks/use-offline-ball-sync";
import { hydrateScoringState, type ScoringPageSnapshot } from "@/lib/scoring-hydration";
import { voiceDeliveryFlags } from "@/lib/scoring-voice-input";

// ─── Types ────────────────────────────────────────────────────

type MatchData = ScoringPageSnapshot;

interface PlayersData {
  teamA: Array<{ id: string; name: string; role: string | null }>;
  teamB: Array<{ id: string; name: string; role: string | null }>;
}

// ─── Scoring Interface ───────────────────────────────────────

function ScoringInterface() {
  const params = useParams();
  const matchId = params.matchId as string;

  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [playersData, setPlayersData] = useState<PlayersData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"scorecard" | "charts" | "commentary">("scorecard");

  const {
    setMatchId,
    currentInnings: currentInningsNum,
    innings1,
    innings2,
    superOver,
    isOnline,
    redo,
    addBall,
    resetInnings,
  } = useScoringStore();

  // Get the actual innings data object
  const currentInningsData =
    currentInningsNum === 1 ? innings1 :
    currentInningsNum === 2 ? innings2 :
    superOver;

  const [selectedBatsman, setSelectedBatsman] = useState<string>();
  const [selectedBatsman2] = useState<string>();
  const [selectedBowler, setSelectedBowler] = useState<string>();

  const totalOvers = matchData?.match.totalOvers ?? 20;

  // Live updates from scoring-service WebSocket (reconnect + backoff)
  const { unavailable: liveUnavailable } = useScoringSocket(matchId, matchData?.tenantId);

  const currentTeamId = currentInningsData?.teamId;

  const [dbWriteFailed, setDbWriteFailed] = useState(false);
  const [sessionFenced, setSessionFenced] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string>();
  const canWrite = !!matchData?.canScore && !sessionFenced;

  const acknowledgeSavedBall = useCallback((result: { ballId: string; clientOpId: string | null; scoringRevision: number }) => {
    const state = useScoringStore.getState();
    if (state.matchId !== matchId) return;
    for (const innings of [state.innings1, state.innings2, state.superOver]) {
      const local = innings?.balls.find(ball => ball.clientOpId === result.clientOpId ||
        `${state.matchId}:${innings.inningsId}:${ball.id}` === result.clientOpId);
      if (local && result.clientOpId) state.acknowledgeBall(local.id, result.ballId, result.clientOpId, result.scoringRevision);
    }
    useScoringStore.getState().observeScoringRevision(result.scoringRevision);
  }, [matchId]);

  // Offline ball queue: replays persisted balls once the connection returns.
  const offlineSync = useOfflineBallSync(matchId);
  const syncSavedBalls = useCallback(() => {
    if (!canWrite) return;
    return offlineSync.sync(async (input) => {
      try {
        const acknowledgement = unwrapScoringFenceResult(await recordBallAction(input as RecordBallInput));
        setDbWriteFailed(false);
        acknowledgeSavedBall(acknowledgement);
        return acknowledgement;
      } catch (err) {
        // A fenced offline replay stays queued (entries only leave the queue on
        // success). Never replace its original epoch: reconciliation is required
        // before pre-handover work can become authoritative.
        const conflict = scoringWriteConflictMessage(err);
        if (conflict) {
          setSessionFenced(true);
          setConflictMessage(conflict);
          toast.error(conflict, { duration: 10000 });
        }
        throw err;
      }
    });
  }, [offlineSync.sync, canWrite, acknowledgeSavedBall]);

  useEffect(() => {
    if (isOnline && offlineSync.pending > 0) void syncSavedBalls();
  }, [isOnline, offlineSync.pending, syncSavedBalls]);

  useEffect(() => {
    const onOnline = () => { void syncSavedBalls(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncSavedBalls]);

  // ─── Load match data from DB ───────────────────────────────
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    async function loadMatchData() {
      try {
        setLoading(true);
        setLoadError(null);

        const [matchResult, playersResult] = await Promise.all([
          getMatchForScoring(matchId),
          getMatchPlayersForScoring(matchId),
        ]);

        if (cancelled) return;

        setMatchData(matchResult as MatchData);
        setPlayersData(playersResult as PlayersData);
        // Apply DB metadata even when an initial socket snapshot arrived first.
        setMatchId(matchId);
        useScoringStore.setState(hydrateScoringState(useScoringStore.getState(), matchResult));
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load match data:", err);
          setLoadError(err instanceof Error ? err.message : "Failed to load match");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatchData();
    return () => { cancelled = true; };
  }, [matchId, setMatchId]);

  // ─── Persist ball to DB (with retry) ────────────────────────
  const refreshOfflineQueue = offlineSync.refresh;

  const persistBallToDB = useCallback(async () => {
    if (!matchData || !canWrite) return;

    const state = useScoringStore.getState();
    const inningsKey = state.currentInnings === 1 ? "innings1" :
      state.currentInnings === 2 ? "innings2" : "superOver";
    const currentInnings = state[inningsKey] as InningsState | null;
    if (!currentInnings || currentInnings.balls.length === 0) return;

    const lastBall = currentInnings.balls[currentInnings.balls.length - 1];
    if (!lastBall) return;

    // Resolve the real innings ID (may need to create in DB first)
    let inningsId = currentInnings.inningsId;

    if (inningsId.startsWith("pending-innings-")) {
      // Create the innings in DB first
      const inningsNumber = state.currentInnings === 1 ? 1 :
        state.currentInnings === 2 ? 2 : 3;
      try {
        const result = unwrapScoringFenceResult(await createInnings({
          matchId: state.matchId,
          teamId: currentInnings.teamId,
          inningsNumber,
          handoverEpoch: state.handoverEpoch,
          expectedRevision: state.scoringRevision,
        }));
        if (result.innings) {
          if (useScoringStore.getState().matchId !== state.matchId) return;
          inningsId = result.innings.id;
          // Update store with real ID
          useScoringStore.setState((latest) => ({
            [inningsKey]: { ...latest[inningsKey], inningsId,
              // Creating the innings consumes one revision before its first
              // queued delivery. Do not rebase over intervening score writes.
              balls: latest[inningsKey]?.balls.map(ball => ball.id.startsWith("ball-") &&
                latest[inningsKey]?.inningsId.startsWith("pending-innings-") &&
                result.innings.scoringRevision === (state.scoringRevision ?? 0) + 1
                ? { ...ball, expectedRevision: (ball.expectedRevision ?? 0) + 1 } : ball),
            },
          } as Partial<typeof state>));
          useScoringStore.getState().observeScoringRevision(result.innings.scoringRevision);
        }
      } catch (err) {
        console.error("Failed to create innings:", err);
        const conflict = scoringWriteConflictMessage(err);
        if (conflict) {
          setSessionFenced(true);
          setConflictMessage(conflict);
          toast.error(conflict, { duration: 10000 });
          return;
        }
        toast.error("Failed to create innings in database. Please try again.");
        return;
      }
    }

    const ballInput: RecordBallInput = {
      matchId: state.matchId,
      inningsId,
      clientOpId: lastBall.clientOpId ?? `${state.matchId}:${inningsId}:${lastBall.id}`,
      overNumber: lastBall.overNumber,
      ballNumber: lastBall.ballNumber,
      runs: lastBall.runs,
      batsmanId: lastBall.batsmanId || null,
      bowlerId: lastBall.bowlerId || null,
      isWicket: lastBall.isWicket,
      wicketType: lastBall.wicketType || null,
      isWide: lastBall.isWide,
      isNoBall: lastBall.isNoBall,
      isBye: lastBall.isBye,
      isLegBye: lastBall.isLegBye,
      isFour: lastBall.isFour ?? false,
      isSix: lastBall.isSix ?? false,
      // SCORE-11 writer fencing: echo the epoch this session observed.
      handoverEpoch: state.handoverEpoch,
      expectedRevision: useScoringStore.getState()[inningsKey]?.balls.find(ball => ball.id === lastBall.id)?.expectedRevision
        ?? pendingDeliveryRevision(useScoringStore.getState()),
    };

    // Save the operation before the first request. A reload or lost response
    // can then replay the same ID without losing or double-applying a ball.
    try {
      await queueBall({
        clientOpId: ballInput.clientOpId,
        matchId: state.matchId, inningsId, payload: { ...ballInput },
      });
    } catch (error) {
      console.error("Could not save delivery before submission:", error);
      setDbWriteFailed(true);
      toast.error("Could not save this delivery on your device. Keep this page open and check device storage.");
      return;
    }

    // Retry with exponential backoff (3 attempts). A handover fence rejection
    // is terminal: the canonical service will keep refusing this session
    // until the scorer reloads, so retrying would only burn the backoff.
    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < MAX_RETRIES) {
      try {
        const acknowledgement = unwrapScoringFenceResult(await recordBallAction(ballInput));
        if (useScoringStore.getState().matchId === state.matchId) {
          useScoringStore.getState().acknowledgeBall(lastBall.id, acknowledgement.ballId, ballInput.clientOpId, acknowledgement.scoringRevision);
        }
        await removeQueuedBall(ballInput.clientOpId);
        await refreshOfflineQueue();
        setDbWriteFailed(false);
        return; // Success
      } catch (err) {
        lastError = err;
        const conflict = scoringWriteConflictMessage(err);
        if (conflict) {
          setSessionFenced(true);
          setConflictMessage(conflict);
          await refreshOfflineQueue();
          toast.error(conflict, { duration: 10000 });
          setDbWriteFailed(true);
          return;
        }
        attempt++;
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 500ms, 1500ms
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
        }
      }
    }

    // All retries failed. The operation was queued before the first attempt.
    console.error("Failed to persist ball to DB after retries:", lastError);
    await refreshOfflineQueue();
    toast.warning("This delivery is saved on this device and is waiting for confirmation. Retry sync when the match is available.", {
      duration: 6000,
    });
    setDbWriteFailed(true);
  }, [matchData, refreshOfflineQueue, canWrite]);

  // ─── Handle Undo with DB persistence ───────────────────────
  const handleUndo = useCallback(async () => {
    if (!canWrite) return;
    const state = useScoringStore.getState();
    const currentInningsState = state.currentInnings === 1 ? state.innings1 :
      state.currentInnings === 2 ? state.innings2 :
      state.superOver;

    if (currentInningsState && currentInningsState.balls.length > 0) {
      const lastBall = currentInningsState.balls[currentInningsState.balls.length - 1];
      if (lastBall.id.startsWith("ball-")) {
        toast.error("Sync this delivery before undoing it so the score stays consistent.");
        return;
      }
      // Apply local undo only after the canonical service accepts it.
      if (lastBall) {
        startTransition(async () => {
          let confirmed = false;
          try {
            const result = unwrapScoringFenceResult(await undoBallAction(state.matchId, lastBall.id, state.handoverEpoch, state.scoringRevision));
            if (useScoringStore.getState().matchId !== state.matchId) return;
            useScoringStore.getState().observeScoringRevision(result.scoringRevision);
            confirmed = true;
            if (lastBall.clientOpId) await removeQueuedBall(lastBall.clientOpId);
            const snapshot = await getMatchForScoring(state.matchId);
            if (useScoringStore.getState().matchId !== state.matchId) return;
            const innings = snapshot.innings.find((value) => value.id === currentInningsState.inningsId);
            if (!innings) throw new Error("Updated innings snapshot unavailable");
            // Keep the session's original epoch even if a handover raced this
            // read. A score refresh must not silently reauthorize this device.
            useScoringStore.getState().applyConfirmedUndo(lastBall.id, innings);
          } catch (err) {
            console.error("Failed to undo ball in DB:", err);
            const conflict = scoringWriteConflictMessage(err);
            if (!confirmed && conflict) {
              setSessionFenced(true);
              setConflictMessage(conflict);
              toast.error(conflict, { duration: 10000 });
              return;
            }
            toast.error(confirmed
              ? "Undo was accepted, but the updated score could not load. Refresh this match."
              : "Undo was not confirmed. The displayed score has not been changed.");
          }
        });
      }
    }
  }, [canWrite]);

  // ─── Voice Command ─────────────────────────────────────────
  const handleVoiceCommand = useCallback(async (input: BallInput) => {
    if (!currentInningsData || !canWrite || isPending || offlineSync.syncing ||
        currentInningsData.status === "completed") return;
    if (!selectedBatsman || !selectedBowler) {
      toast.error("Select a batter and bowler before recording a delivery.");
      return;
    }
    const flags = voiceDeliveryFlags(input);
    if (!flags) {
      toast.info("Use the wicket button to select the dismissal type.");
      return;
    }
    const overNumber = currentInningsData.currentBall === 6 ? currentInningsData.currentOver + 1 : currentInningsData.currentOver;
    const ballNumber = currentInningsData.currentBall === 6 ? 1 : currentInningsData.currentBall + 1;
    addBall({
      overNumber,
      ballNumber,
      ...flags,
      batsmanId: selectedBatsman,
      bowlerId: selectedBowler,
    });
    // Persist to DB directly (with retry)
    await persistBallToDB();
  }, [currentInningsData, addBall, selectedBatsman, selectedBowler, persistBallToDB,
    canWrite, isPending, offlineSync.syncing]);

  const targetRuns = innings1 && currentInningsNum === 2 ? innings1.totalRuns + 1 : undefined;

  // ─── Loading State ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Loading match data...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-semibold">Failed to Load Match</h2>
          <p className="text-muted-foreground text-sm">{loadError}</p>
          <Button onClick={() => window.location.reload()} variant="outline">
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background px-3 pt-2 sm:p-6 space-y-3 sm:space-y-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
    >
      {liveUnavailable && <p role="alert" className="text-sm text-warning">Public live updates are unavailable. Scoring commands still require server confirmation.</p>}
      {/* Sticky mobile header: score + connection + undo */}
      <div className="sticky top-0 z-20 -mx-3 px-3 py-2 sm:static sm:mx-0 sm:px-0 sm:py-0 bg-background/95 backdrop-blur border-b sm:border-0 supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-3xl font-bold truncate">
                {matchData ? (
                  <span className="sm:hidden">
                    {matchData.teamA.name.slice(0, 12)} vs {matchData.teamB.name.slice(0, 12)}
                  </span>
                ) : null}
                <span className="hidden sm:inline">Live Scoring</span>
              </h1>
              {isOnline ? (
                <span className="flex items-center gap-1 text-green-600 text-xs sm:text-sm shrink-0">
                  <Wifi className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline sm:inline">Online</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-orange-600 text-xs sm:text-sm shrink-0">
                  <WifiOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Offline
                </span>
              )}
              {dbWriteFailed && (
                <span className="flex items-center gap-1 text-red-600 text-xs" role="alert">
                  <AlertCircle className="h-3 w-3" />
                  Unsaved
                </span>
              )}
              {isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
              )}
            </div>
            <div className="hidden sm:block text-sm text-muted-foreground mt-1">
              {matchData && (
                <span>
                  {matchData.teamA.name} vs {matchData.teamB.name}
                  {matchData.match.totalOvers && ` · ${matchData.match.totalOvers} overs`}
                </span>
              )}
            </div>
            <div className="sm:hidden mt-1.5">
              <LiveScorecard compact targetRuns={targetRuns} totalOvers={totalOvers} />
            </div>
          </div>

          <div className="flex gap-1.5 shrink-0">
            <Button
              onClick={handleUndo}
              disabled={!canWrite || isPending || offlineSync.syncing}
              variant="outline"
              size="sm"
              className="touch-manipulation min-h-11 min-w-11 px-3 sm:px-3"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Undo</span>
            </Button>
            <Button
              onClick={redo}
              disabled
              title="Redo requires a new server-confirmed delivery; local-only redo is unavailable"
              variant="outline"
              size="sm"
              className="touch-manipulation min-h-11 min-w-11 px-3 sm:px-3 hidden sm:inline-flex"
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4 mr-1" />
              Redo
            </Button>
          </div>
        </div>
      </div>

      {matchData && !matchData.canScore && (
        <Card className="p-3 text-sm" role="status">
          Read-only scoreboard. Ask your league owner to assign you as this match’s scorer to record deliveries.
        </Card>
      )}

      {sessionFenced && (
        <Card className="p-3 space-y-2 text-sm" role="alert">
          <p>{conflictMessage ?? HANDOVER_RESYNC_COPY} Saved deliveries have not been discarded or reauthorized.</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload session</Button>
          <ScoringRecoveryPanel matchId={matchId} onConfirmed={acknowledgeSavedBall} />
        </Card>
      )}

      {offlineSync.pending > 0 && (
        <Card className="p-3 flex flex-wrap items-center justify-between gap-3" role="status">
          <p className="text-sm">{offlineSync.pending} saved deliveries waiting to sync</p>
          <Button size="sm" variant="outline" disabled={!canWrite || !isOnline || offlineSync.syncing}
            onClick={() => { void syncSavedBalls(); }}>
            {offlineSync.syncing ? "Syncing..." : "Retry sync"}
          </Button>
        </Card>
      )}

      {/* Desktop-only extras row */}
      <div className="hidden sm:flex flex-wrap gap-2">
        {currentInningsNum === 2 && targetRuns && (
          <DLSCalculator
            targetRuns={targetRuns}
            oversCompleted={currentInningsData ? currentInningsData.currentOver + currentInningsData.currentBall / 6 : 0}
            totalOvers={totalOvers}
            wicketsLost={currentInningsData?.totalWickets || 0}
            runsScored={currentInningsData?.totalRuns || 0}
            onApply={(revisedTarget) => {
              console.log("DLS target applied:", revisedTarget);
            }}
          />
        )}
        {currentInningsNum === "super_over" && (
          <Button
            onClick={() => resetInnings("super_over")}
            variant="outline"
            size="sm"
          >
            <Zap className="h-4 w-4 mr-1" />
            Super Over
          </Button>
        )}
      </div>

      {/* Innings Selector — scrollable chips on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        <Button
          onClick={() => useScoringStore.setState({ currentInnings: 1 })}
          variant={currentInningsNum === 1 ? "default" : "outline"}
          size="sm"
          className="touch-manipulation shrink-0"
        >
          Inn 1{matchData ? ` · ${matchData.teamA.name.slice(0, 8)}` : ""}
        </Button>
        <Button
          onClick={() => useScoringStore.setState({ currentInnings: 2 })}
          variant={currentInningsNum === 2 ? "default" : "outline"}
          size="sm"
          className="touch-manipulation shrink-0"
        >
          Inn 2{matchData ? ` · ${matchData.teamB.name.slice(0, 8)}` : ""}
        </Button>
        <Button
          onClick={() => useScoringStore.setState({ currentInnings: "super_over" })}
          variant={currentInningsNum === "super_over" ? "default" : "outline"}
          size="sm"
          className="touch-manipulation shrink-0"
        >
          Super
        </Button>
      </div>

      {/* Full scorecard on desktop only (mobile uses compact sticky) */}
      <div className="hidden sm:block">
        <LiveScorecard targetRuns={targetRuns} totalOvers={totalOvers} />
      </div>

      {/* Tabs — Scorecard = ball pad; Charts secondary */}
      <div className="flex gap-1 border-b" role="tablist" aria-label="Scoring views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "scorecard"}
          onClick={() => setActiveTab("scorecard")}
          className={`flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm font-medium touch-manipulation ${
            activeTab === "scorecard"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
        >
          Score
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "charts"}
          onClick={() => setActiveTab("charts")}
          className={`flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm font-medium touch-manipulation ${
            activeTab === "charts"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
        >
          Charts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "commentary"}
          onClick={() => setActiveTab("commentary")}
          className={`flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm font-medium touch-manipulation ${
            activeTab === "commentary"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
        >
          Commentary
        </button>
      </div>

      {activeTab === "scorecard" ? (
        <div className="space-y-3 sm:space-y-4">
          {/* Ball pad first — thumb zone */}
          <Card className="p-3 sm:p-6">
            {/* flex-wrap + gap: this row can hold four items (title, queued
                badge, over counter, End Innings). Without wrapping they
                collide on a 320-375px phone, which is the primary device
                scorers use. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-semibold">Ball Input</h2>
              <div className="flex flex-wrap items-center gap-2">
                {offlineSync.pending > 0 && (
                  <span className="text-xs font-medium text-amber-600 inline-flex items-center gap-1">
                    <WifiOff className="h-3.5 w-3.5" />
                    {offlineSync.pending} queued
                  </span>
                )}
                {currentInningsData && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Over {currentInningsData.currentOver}.{currentInningsData.currentBall}
                  </span>
                )}
                {currentInningsData && currentInningsData.status !== "completed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="touch-manipulation min-h-11"
                    disabled={!canWrite || isPending || offlineSync.syncing || offlineSync.pending > 0}
                    onClick={async () => {
                      try {
                        const result = unwrapScoringFenceResult(await completeInningsAction(
                          matchId,
                          currentInningsData.inningsId,
                          useScoringStore.getState().handoverEpoch,
                          useScoringStore.getState().scoringRevision,
                        ));
                        if (useScoringStore.getState().matchId !== matchId) return;
                        useScoringStore.getState().observeScoringRevision(result.scoringRevision);
                        toast.success("Innings completed");
                      } catch (e) {
                        const conflict = scoringWriteConflictMessage(e);
                        if (conflict) {
                          setSessionFenced(true);
                          setConflictMessage(conflict);
                          toast.error(conflict, { duration: 10000 });
                          return;
                        }
                        // Route through the shared resolver so a plan-limit
                        // error renders as an upgrade prompt and never leaks the
                        // internal wire payload into a toast.
                        const resolved = resolveActionError(e, "Failed to complete innings");
                        toast.error(resolved.message);
                      }
                    }}
                  >
                    End Innings
                  </Button>
                )}
              </div>
            </div>
            <BallInputComponent
              disabled={!canWrite || isPending || offlineSync.syncing || currentInningsData?.status === "completed"}
              batsmanId={selectedBatsman}
              bowlerId={selectedBowler}
              onBallAdded={persistBallToDB}
            />
          </Card>

          {currentInningsData && (
            <div className="flex gap-2 flex-wrap px-0.5">
              {currentInningsData.balls
                .filter((b) => b.overNumber === currentInningsData.currentOver)
                .map((ball) => (
                  <div
                    key={ball.id}
                    className={`min-w-9 min-h-9 flex items-center justify-center px-2 rounded-md text-sm font-medium ${
                      ball.isWicket
                        ? "bg-red-500 text-white"
                        : ball.isFour
                        ? "bg-orange-500 text-white"
                        : ball.isSix
                        ? "bg-red-600 text-white"
                        : "bg-muted"
                    }`}
                  >
                    {ball.isWicket ? "W" : ball.runs}
                    {ball.isWide && "WD"}
                    {ball.isNoBall && "NB"}
                    {ball.isBye && "B"}
                    {ball.isLegBye && "LB"}
                  </div>
                ))}
            </div>
          )}

          {currentTeamId && playersData && (
            <Card className="p-3 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Players</h2>
              <PlayerSelector
                matchId={matchId}
                teamId={currentTeamId}
                playersData={playersData}
                onBatsmanSelect={setSelectedBatsman}
                onBowlerSelect={setSelectedBowler}
                selectedBatsman={selectedBatsman}
                selectedBowler={selectedBowler}
                selectedBatsman2={selectedBatsman2}
              />
            </Card>
          )}

          <Card className="p-3 sm:p-6 hidden sm:block">
            <h2 className="text-lg font-semibold mb-4">Voice Input</h2>
            <VoiceInput onCommand={handleVoiceCommand} />
          </Card>
        </div>
      ) : activeTab === "charts" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ManhattanChart />
          <WagonWheel />
          <WormChart />
        </div>
      ) : (
        <Card className="p-3 sm:p-6">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold">Live Commentary</h2>
            <LanguageSelector />
          </div>
          <CommentaryFeed />
        </Card>
      )}
    </div>
  );
}

export default function ScoringPage() {
  return <ScoringInterface />;
}
