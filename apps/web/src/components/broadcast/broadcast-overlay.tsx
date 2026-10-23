"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  clampGraphicsOffsetMs,
  GRAPHICS_OFFSET_MS_MAX,
  GRAPHICS_OFFSET_MS_MIN,
  GRAPHICS_OFFSET_MS_STEP,
  planBroadcastCelebrations,
  pruneBroadcastCelebrations,
  SNAPSHOT_STALE_AFTER_MS,
  type BroadcastCelebrationEvent,
  type BroadcastOverlayParticipants,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"
import { getScoringSocket } from "@/lib/scoring-socket"
import { persistOverlayOffsetMs, readOverlayOffsetMs } from "@/lib/broadcast-overlay-settings"
import {
  dueHeldCelebrations,
  ingestHeldCelebrations,
  pruneQueuedCelebrations,
  type HeldCelebration,
} from "@/lib/broadcast-latency-buffer"

/**
 * ENH-09-01/03: read-only scoreboard for OBS.
 *
 * The socket only TRIGGERS a snapshot refresh; every number shown comes from
 * the token-bound snapshot endpoint, which rechecks publication. Celebrations
 * are derived from the official snapshot diff (stable delivery ids + scoring
 * revision), queued to at most four, and pruned when an undo removes the
 * delivery. A reconnect primes the baseline instead of replaying a backlog.
 * "Last batter"/"Last bowler" are aggregates of recorded deliveries, never a
 * claim about who is on strike. Batch 100: when the server attaches a
 * CONFIRMED participants projection, the crease card shows striker
 * (strike-marked)/non-striker figures and the over's bowler from that
 * canonical state; an unconfirmed or absent projection falls back to the
 * aggregate-only presentation below.
 *
 * Batch 101 (ENH-09-04): operator A/V calibration. Celebrations may be HELD
 * for a bounded graphics offset (`?offsetMs=` or the on-page panel) so burned
 * animations line up with the programme feed. The offset delays ANIMATED
 * EVENTS only - the scoreboard numbers still render from the last confirmed
 * official snapshot immediately, and no official persistence is ever delayed.
 * An undo/correction prises events out of the delay buffer too, so a retracted
 * claim can never appear on stream just because it was held. A stale-snapshot
 * indicator is shown ONLY while the page has focus: an operator rehearsing in
 * a browser tab sees a dropped connection, while the unfocused OBS browser
 * source on air does not display diagnostic chrome to viewers.
 */

type AnimationMode = "full" | "reduced" | "off"

export function BroadcastOverlay({
  initial,
  matchId,
  tenantId,
  token,
  animations,
  graphicsOffsetMs,
}: {
  initial: BroadcastOverlaySnapshot
  matchId: string
  tenantId: string
  token: string
  animations: AnimationMode
  /** ENH-09-04: `?offsetMs=` value already normalized server-side, or null
   *  when the URL did not configure one (stored preference then applies). */
  graphicsOffsetMs?: number | null
}) {
  const [snapshot, setSnapshot] = useState<BroadcastOverlaySnapshot | null>(initial)
  const [unavailable, setUnavailable] = useState(false)
  const inFlight = useRef(false)
  const previousSnapshot = useRef<BroadcastOverlaySnapshot | null>(initial)
  const suppressNextEvents = useRef(false)
  const seenEventIds = useRef(new Set<string>())
  const [queue, setQueue] = useState<BroadcastCelebrationEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<BroadcastCelebrationEvent | null>(null)

  // ── Batch 101: operator graphics offset ────────────────────────────
  // An explicit `?offsetMs=` prop is a deliberate operator configuration and
  // also becomes the stored preference; otherwise the stored one applies.
  const [eventOffsetMs, setEventOffsetMs] = useState(() => graphicsOffsetMs ?? 0)
  useEffect(() => {
    if (typeof window === "undefined") return
    if (graphicsOffsetMs != null) {
      persistOverlayOffsetMs(graphicsOffsetMs, window.localStorage)
      return
    }
    setEventOffsetMs(readOverlayOffsetMs({ storage: window.localStorage }))
    // Run once on mount; the URL prop is fixed per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const updateOffset = useCallback((next: number) => {
    const clamped = clampGraphicsOffsetMs(next)
    setEventOffsetMs(clamped)
    if (typeof window !== "undefined") persistOverlayOffsetMs(clamped, window.localStorage)
  }, [])

  // ── Batch 101: stale-snapshot visibility for OPERATORS ─────────────
  const lastSuccessfulPollAt = useRef(Date.now())
  const [onFocusTab, setOnFocusTab] = useState(false)
  const [, tickStaleCheck] = useState(0)
  useEffect(() => {
    if (typeof window === "undefined") return
    const update = () => {
      setOnFocusTab(document.hasFocus())
      tickStaleCheck(count => count + 1)
    }
    // The interval re-evaluates staleness while idle; focus/blur catch a
    // window gaining/losing focus between ticks.
    const interval = window.setInterval(update, 2_000)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    update()
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
    }
  }, [])
  const showStaleIndicator = onFocusTab && !unavailable
    && Date.now() - lastSuccessfulPollAt.current > SNAPSHOT_STALE_AFTER_MS

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await fetch(
        `/api/broadcast/overlay/${encodeURIComponent(matchId)}/snapshot?token=${encodeURIComponent(token)}`,
        { cache: "no-store", credentials: "same-origin" },
      )
      if (response.status === 404) {
        // Unpublished/withdrawn: drop the last score instead of leaving stale
        // data on stream.
        setSnapshot(null)
        setUnavailable(true)
        return
      }
      if (!response.ok) return
      const next = await response.json() as BroadcastOverlaySnapshot
      if (next.matchId !== matchId) return
      // Batch 101: any applied snapshot is fresh evidence of a live read.
      lastSuccessfulPollAt.current = Date.now()
      setSnapshot(next)
      setUnavailable(false)
    } catch {
      // Keep the last confirmed snapshot; the next poll or socket event retries.
    } finally {
      inFlight.current = false
    }
  }, [matchId, token])

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const socket = getScoringSocket()
    let connectedOnce = false
    const join = () => {
      // A reconnect must fast-forward to the current snapshot, not replay the
      // celebrations that happened while OBS was disconnected.
      if (connectedOnce) suppressNextEvents.current = true
      connectedOnce = true
      socket.emit("join-match", { matchId, tenantId }, () => {})
      void refresh()
    }
    const onEvent = (payload: unknown) => {
      if (payload && typeof payload === "object" && "matchId" in payload) {
        if ((payload as { matchId?: unknown }).matchId !== matchId) return
      }
      void refresh()
    }
    socket.on("connect", join)
    socket.on("match-state", onEvent)
    socket.on("score-update", onEvent)
    if (socket.connected) join()
    else socket.connect()
    return () => {
      socket.off("connect", join)
      socket.off("match-state", onEvent)
      socket.off("score-update", onEvent)
      socket.emit("leave-match", { matchId, tenantId })
    }
  }, [matchId, tenantId, refresh])

  // ── Batch 101: latency buffer ──────────────────────────────────────
  // Planned celebrations wait here for `revealAt` instead of jumping into the
  // on-screen queue, so an operator can align burned graphics with the
  // programme A/V. Held events stay subject to the SAME undo pruning as the
  // queue: a retracted event can never surface merely because it was held.
  // The state machine below delegates to lib/broadcast-latency-buffer, whose
  // sequencing is pinned by __tests__/broadcast-latency-buffer.test.ts.
  const pendingRef = useRef<HeldCelebration[]>([])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const { due, held } = dueHeldCelebrations(pendingRef.current, now)
      if (due.length === 0) return
      pendingRef.current = held
      setQueue(current => [...current, ...due].slice(-4))
    }, 50)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!snapshot) {
      previousSnapshot.current = null
      seenEventIds.current.clear()
      pendingRef.current = []
      setQueue([])
      setActiveEvent(null)
      return
    }

    const previous = previousSnapshot.current
    previousSnapshot.current = snapshot
    if (animations === "off") {
      pendingRef.current = []
      setQueue([])
      setActiveEvent(null)
      return
    }

    let events = planBroadcastCelebrations({ previous, next: snapshot, mode: animations })
    if (suppressNextEvents.current) {
      // `join` immediately refreshes, so the next successful snapshot is the
      // post-reconnect baseline. Swallow its backlog, then resume live events.
      suppressNextEvents.current = false
      events = []
    }

    // Prune queued, on-screen-queued and STILL-HELD events against the new
    // official snapshot (undo / revision regression), dropping their dedup
    // ids exactly like the pre-offset flow did.
    setQueue(current => {
      const { kept, forgottenIds } = pruneQueuedCelebrations(current, snapshot)
      for (const id of forgottenIds) seenEventIds.current.delete(id)
      return kept
    })
    // Fold this poll's newly planned events into the hold buffer: prunes
    // survivors, dedups, and anchors `revealAt` at plan time. The offset is a
    // rendering delay for animations only, re-checked against the wall clock.
    const ingest = ingestHeldCelebrations({
      planned: events,
      held: pendingRef.current,
      seenIds: seenEventIds.current,
      snapshot,
      now: Date.now(),
      offsetMs: eventOffsetMs,
    })
    pendingRef.current = ingest.held
    seenEventIds.current = ingest.seenIds
  }, [snapshot, animations, eventOffsetMs])

  useEffect(() => {
    if (!snapshot || !activeEvent) return
    if (pruneBroadcastCelebrations([activeEvent], snapshot).length > 0) return
    // An undo/correction can arrive while the animation is on screen.
    seenEventIds.current.delete(activeEvent.id)
    setActiveEvent(null)
  }, [snapshot, activeEvent])

  useEffect(() => {
    if (activeEvent || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    setActiveEvent(next)
  }, [activeEvent, queue])

  useEffect(() => {
    if (!activeEvent) return
    const timer = window.setTimeout(
      () => setActiveEvent(null),
      animations === "reduced" ? 1_300 : 1_800,
    )
    return () => window.clearTimeout(timer)
  }, [activeEvent, animations])

  if (unavailable) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="rounded-xl bg-black/80 px-8 py-5 text-2xl font-semibold text-white">
          Overlay unavailable
        </p>
      </div>
    )
  }

  if (!snapshot) return null

  const current = snapshot.current
  // Batch 100: only a CONFIRMED canonical participants block may carry a
  // strike/bowler claim. Unconfirmed folds (drift, off-crease attribution)
  // degrade to the aggregate-only presentation.
  const confirmedParticipants = current?.participants?.confirmed === true
    ? current.participants
    : null
  const battingId = current?.battingTeamId
  const statusLabel = snapshot.status === "live"
    ? "LIVE"
    : ["completed", "no_result", "forfeited", "abandoned"].includes(snapshot.status)
      ? "RESULT"
      : "UPCOMING"
  const teamCard = (
    team: BroadcastOverlaySnapshot["teams"]["teamA"],
    align: "left" | "right",
  ) => (
    <div className={`flex min-w-0 flex-1 items-center gap-5 ${align === "right" ? "justify-end text-right" : ""}`}>
      {align === "left" && <TeamMark name={team.name} logoUrl={team.logoUrl} />}
      <div className="min-w-0">
        <p className="truncate text-4xl font-semibold tracking-tight">{team.name}</p>
        <p className={`mt-1 text-5xl font-black tabular-nums ${team.id === battingId ? "text-white" : "text-white/70"}`}>
          {team.runs}/{team.wickets}
          <span className="ml-3 text-2xl font-medium text-white/60">{team.overs}</span>
        </p>
      </div>
      {align === "right" && <TeamMark name={team.name} logoUrl={team.logoUrl} />}
    </div>
  )

  return (
    <div className="absolute inset-0 flex flex-col justify-between p-14">
      {/* Batch 101 (ENH-09-04): operator-only diagnostics. The stale indicator
          renders ONLY while this page has window focus - an operator
          rehearsing in a browser tab sees a dropped feed within
          SNAPSHOT_STALE_AFTER_MS, while the unfocused OBS browser source on
          air stays clean for viewers. Scoreboard numbers themselves are never
          hidden or replaced by this badge. */}
      {showStaleIndicator && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-6 top-6 z-50 rounded-lg bg-red-900/95 px-5 py-2.5 text-xl font-bold tracking-wide text-white shadow-lg"
        >
          STALE DATA — CHECK CONNECTION
        </div>
      )}

      {/* Batch 101 (ENH-09-04): operator A/V calibration. Holds ANIMATED
          EVENTS back by the offset so burned graphics match the programme
          timeline; the offset never delays reading an official snapshot or
          official persistence. The panel stays at 15% opacity (nearly
          invisible in OBS) and reveals on hover/focus for the operator. */}
      <div className="absolute bottom-8 left-8 z-50 flex items-center gap-3 rounded-xl bg-black/85 px-4 py-2.5 text-base text-white opacity-15 shadow-lg transition-opacity hover:opacity-100 focus-within:opacity-100">
        <span className="font-semibold tracking-wide text-white/80">A/V OFFSET</span>
        <button
          type="button"
          onClick={() => updateOffset(eventOffsetMs - GRAPHICS_OFFSET_MS_STEP)}
          disabled={eventOffsetMs <= GRAPHICS_OFFSET_MS_MIN}
          className="min-h-[44px] min-w-[44px] rounded-md bg-white/10 text-2xl font-bold hover:bg-white/20 disabled:opacity-30"
        >
          −
        </button>
        <span aria-live="polite" className="min-w-[18ch] text-center text-lg font-bold tabular-nums">
          {(eventOffsetMs / 1000).toFixed(2)} s
        </span>
        <button
          type="button"
          onClick={() => updateOffset(eventOffsetMs + GRAPHICS_OFFSET_MS_STEP)}
          disabled={eventOffsetMs >= GRAPHICS_OFFSET_MS_MAX}
          className="min-h-[44px] min-w-[44px] rounded-md bg-white/10 text-2xl font-bold hover:bg-white/20 disabled:opacity-30"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => updateOffset(0)}
          disabled={eventOffsetMs === 0}
          className="min-h-[44px] rounded-md bg-white/10 px-3 text-sm font-bold hover:bg-white/20 disabled:opacity-30"
        >
          Reset
        </button>
        <span className="text-xs text-white/50">?offsetMs=</span>
      </div>
      <style>{`
        @keyframes overlay-pop {
          0% { transform: scale(.6); opacity: 0; }
          35% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .overlay-pop { animation: overlay-pop 420ms ease-out both; }
        .overlay-celebrate { animation: overlay-pop 380ms ease-out both; }
      `}</style>

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-5 rounded-2xl bg-black/65 px-7 py-4 backdrop-blur-sm">
          <TeamMark name={snapshot.league.name} logoUrl={snapshot.league.logoUrl} size="lg" />
          <div>
            <p className="text-3xl font-bold tracking-tight">{snapshot.league.name}</p>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-white/60">
              Official scoreboard
            </p>
          </div>
        </div>
        <div
          className={`rounded-full px-6 py-3 text-xl font-black tracking-[0.2em] ${
            statusLabel === "LIVE" ? "bg-red-600 text-white" : "bg-white/15 text-white/80"
          }`}
        >
          {statusLabel}
        </div>
      </header>

      {activeEvent && (
        <div
          className={`pointer-events-none absolute left-1/2 top-32 z-20 -translate-x-1/2 ${
            animations === "full" ? "overlay-celebrate" : ""
          }`}
          role="status"
          aria-live="polite"
        >
          <div
            className={`rounded-2xl border px-10 py-5 text-center shadow-2xl backdrop-blur-sm ${
              activeEvent.kind === "wicket"
                ? "border-red-400/60 bg-red-700/95 text-white"
                : activeEvent.kind === "result"
                  ? "border-amber-300/60 bg-amber-400/95 text-black"
                  : "border-white/25 bg-black/85 text-white"
            }`}
          >
            <p className="text-4xl font-black tracking-wide">{activeEvent.title}</p>
            {activeEvent.detail && (
              <p className="mt-1 text-lg font-medium opacity-80">{activeEvent.detail}</p>
            )}
          </div>
        </div>
      )}

      <section className="rounded-3xl bg-black/70 p-10 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-10">
          {teamCard(snapshot.teams.teamA, "left")}
          <div className="shrink-0 rounded-2xl bg-white/10 px-8 py-5 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/55">
              {current ? `${current.inningsNumber === 1 ? "1st" : current.inningsNumber === 2 ? "2nd" : "Super over"} innings` : "Match"}
            </p>
            <p className="mt-2 text-7xl font-black tabular-nums leading-none">
              {current ? `${current.runs}/${current.wickets}` : "—"}
            </p>
            <p className="mt-3 text-2xl font-medium tabular-nums text-white/75">
              {current ? `${current.overs} ov · RR ${current.runRate}` : "Yet to start"}
            </p>
            {current?.target != null && (
              <p className="mt-2 text-lg font-medium text-amber-300">
                Target {current.target}
                {current.requiredRate ? ` · Req ${current.requiredRate}` : ""}
              </p>
            )}
          </div>
          {teamCard(snapshot.teams.teamB, "right")}
        </div>

        {current && (
          <div className="mt-9 grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-6 border-t border-white/15 pt-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">Recent balls</p>
              <div className="mt-2 flex items-center gap-2">
                {current.recentBalls.length === 0 && <span className="text-lg text-white/50">—</span>}
                {current.recentBalls.map(ball => (
                  <span
                    key={ball.key}
                    className={`flex h-12 min-w-12 items-center justify-center rounded-full px-3 text-xl font-black ${
                      ball.tone === "wicket"
                        ? "bg-red-600 text-white"
                        : ball.tone === "boundary"
                          ? "bg-amber-400 text-black"
                          : ball.tone === "extra"
                            ? "bg-sky-700 text-white"
                            : "bg-white/15 text-white"
                    }`}
                  >
                    {ball.label}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">
                {confirmedParticipants ? "At the crease" : "Last delivery"}
              </p>
              {confirmedParticipants ? (
                <ParticipantCrease participants={confirmedParticipants} />
              ) : (
                <p className="mt-1 truncate text-2xl font-semibold">
                  {current.lastBatter
                    ? `${current.lastBatter.name} ${current.lastBatter.runs} (${current.lastBatter.balls})`
                    : "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">Bowling</p>
              <p className="mt-1 truncate text-2xl font-semibold">
                {confirmedParticipants
                  ? // Between overs the next bowler is deliberately unknown per
                    // the canonical fold - the overlay says so instead of
                    // showing a stale name as if they were bowling now.
                    confirmedParticipants.bowler
                    ? `${confirmedParticipants.bowler.name} ${confirmedParticipants.bowler.wickets}/${confirmedParticipants.bowler.runs}`
                    : "End of over"
                  : current.lastBowler
                    ? `${current.lastBowler.name} ${current.lastBowler.wickets}/${current.lastBowler.runs}`
                    : "—"}
              </p>
            </div>
            <div className="text-right text-sm text-white/45">
              <p>Recorded deliveries</p>
              <p className="tabular-nums">{snapshot.updatedAt.slice(11, 19)} UTC</p>
            </div>
          </div>
        )}
      </section>

      <footer className="flex items-center justify-between text-lg text-white/55">
        <span>Read-only scoring overlay</span>
        <span>{current ? `Innings ${current.inningsNumber}` : "Awaiting first innings"}</span>
      </footer>
    </div>
  )
}

function TeamMark({
  name,
  logoUrl,
  size = "md",
}: {
  name: string
  logoUrl: string | null
  size?: "md" | "lg"
}) {
  const classes = size === "lg" ? "h-16 w-16" : "h-20 w-20"
  if (logoUrl) {
    // Plain img: legacy branding hosts vary. The overlay is token-gated and
    // never renders provider player chrome.
    return <img src={logoUrl} alt="" className={`${classes} shrink-0 rounded-full object-cover`} />
  }
  return (
    <div className={`${classes} flex shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl font-black`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

/**
 * Batch 100: the crease card from the CONFIRMED canonical participants
 * block. Striker first and strike-marked. Between a dismissal and the new
 * batter's first recorded delivery there is deliberately no striker claim -
 * the crease list still names the survivor, un-positioned.
 */
function ParticipantCrease({ participants }: { participants: BroadcastOverlayParticipants }) {
  const rows = participants.striker
    ? ([participants.striker, participants.nonStriker].filter(
      (batter): batter is NonNullable<typeof batter> => batter != null))
    : participants.crease
  if (rows.length === 0) return <p className="mt-1 text-2xl text-white/50">—</p>
  return (
    <div className="mt-1 space-y-1">
      {rows.map(batter => (
        <p key={batter.id} className="truncate text-2xl font-semibold">
          {batter.name}{" "}
          <span className="tabular-nums text-white/70">
            {batter.runs} ({batter.balls})
          </span>
          {participants.striker?.id === batter.id && (
            <span className="ml-2 text-amber-300" title="On strike">●</span>
          )}
          {participants.incomingBatter?.id === batter.id && (
            <span className="ml-2 rounded bg-sky-700 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-widest text-white">
              New
            </span>
          )}
        </p>
      ))}
    </div>
  )
}
