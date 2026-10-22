"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  planBroadcastCelebrations,
  pruneBroadcastCelebrations,
  type BroadcastCelebrationEvent,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"
import { getScoringSocket } from "@/lib/scoring-socket"

/**
 * ENH-09-01/03: read-only scoreboard for OBS.
 *
 * The socket only TRIGGERS a snapshot refresh; every number shown comes from
 * the token-bound snapshot endpoint, which rechecks publication. Celebrations
 * are derived from the official snapshot diff (stable delivery ids + scoring
 * revision), queued to at most four, and pruned when an undo removes the
 * delivery. A reconnect primes the baseline instead of replaying a backlog.
 * "Last batter"/"Last bowler" are aggregates of recorded deliveries, never a
 * claim about who is on strike.
 */

type AnimationMode = "full" | "reduced" | "off"

export function BroadcastOverlay({
  initial,
  matchId,
  tenantId,
  token,
  animations,
}: {
  initial: BroadcastOverlaySnapshot
  matchId: string
  tenantId: string
  token: string
  animations: AnimationMode
}) {
  const [snapshot, setSnapshot] = useState<BroadcastOverlaySnapshot | null>(initial)
  const [unavailable, setUnavailable] = useState(false)
  const inFlight = useRef(false)
  const previousSnapshot = useRef<BroadcastOverlaySnapshot | null>(initial)
  const suppressNextEvents = useRef(false)
  const seenEventIds = useRef(new Set<string>())
  const [queue, setQueue] = useState<BroadcastCelebrationEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<BroadcastCelebrationEvent | null>(null)

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

  useEffect(() => {
    if (!snapshot) {
      previousSnapshot.current = null
      seenEventIds.current.clear()
      setQueue([])
      setActiveEvent(null)
      return
    }

    const previous = previousSnapshot.current
    previousSnapshot.current = snapshot
    if (animations === "off") {
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

    setQueue(current => {
      const nextQueue = pruneBroadcastCelebrations(current, snapshot)
      const kept = new Set(nextQueue.map(event => event.id))
      for (const event of current) {
        if (!kept.has(event.id)) seenEventIds.current.delete(event.id)
      }
      for (const event of events) {
        if (seenEventIds.current.has(event.id)) continue
        seenEventIds.current.add(event.id)
        nextQueue.push(event)
      }
      return nextQueue.slice(-4)
    })
  }, [snapshot, animations])

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
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">Last delivery</p>
              <p className="mt-1 truncate text-2xl font-semibold">
                {current.lastBatter
                  ? `${current.lastBatter.name} ${current.lastBatter.runs} (${current.lastBatter.balls})`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">Bowling</p>
              <p className="mt-1 truncate text-2xl font-semibold">
                {current.lastBowler
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
