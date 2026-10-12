import type { Socket } from "socket.io-client"
import { decodeLiveMatchState, type LiveMatchState } from "@mtk/database/lib/live-scoring-state"
import { useScoringStore } from "@/stores/scoring-store"
import { useCommentaryStore } from "@/stores/commentary-store"
import { hasUnconfirmedDeliveries, reconcileLiveState } from "./reconcile-live-state"

interface BrowserConnection {
  online: () => boolean
  on: (event: "online" | "offline", listener: () => void) => void
  off: (event: "online" | "offline", listener: () => void) => void
}

// A shared socket may serve more than one mounted scoreboard for the same match.
const subscriptions = new Map<string, number>()

export function subscribeToLiveMatch(socket: Socket, matchId: string, browser: BrowserConnection = {
  online: () => navigator.onLine,
  on: (event, listener) => window.addEventListener(event, listener),
  off: (event, listener) => window.removeEventListener(event, listener),
}) {
  let cancelled = false
  let deferredSnapshot: LiveMatchState | null = null
  subscriptions.set(matchId, (subscriptions.get(matchId) ?? 0) + 1)
  const setOnline = (online: boolean) => useScoringStore.getState().setOnline(online)

  const join = () => {
    if (cancelled) return
    socket.emit("join-match", { matchId }, (ack?: { success?: boolean; error?: string }) => {
      if (cancelled) {
        if (ack?.success && !subscriptions.has(matchId)) socket.emit("leave-match", { matchId })
      } else if (ack?.success === false) {
        console.warn("[scoring-ws] join-match failed:", ack.error)
      }
    })
  }
  const onConnect = () => { setOnline(true); join() }
  const onDisconnect = () => setOnline(browser.online())
  const onScoreUpdate = (scorecard: { matchId?: string }) => {
    if (scorecard?.matchId === matchId) join()
  }
  const onMatchState = (input: unknown) => {
    const snapshot = decodeLiveMatchState(input)
    const state = useScoringStore.getState()
    if (!snapshot || snapshot.matchId !== matchId || state.matchId !== matchId) return
    if (hasUnconfirmedDeliveries(state)) {
      deferredSnapshot = snapshot
      return
    }
    useScoringStore.setState(reconcileLiveState(state, snapshot))
  }
  const unsubscribe = useScoringStore.subscribe((state) => {
    if (!deferredSnapshot || hasUnconfirmedDeliveries(state)) return
    const snapshot = deferredSnapshot
    deferredSnapshot = null
    // Fetch again after confirmation rather than briefly restoring older totals.
    if (snapshot.matchId === state.matchId) join()
  })
  const onCommentaryUpdate = (entry: Parameters<ReturnType<typeof useCommentaryStore.getState>["addEntry"]>[0]) => {
    if (entry?.matchId === matchId) useCommentaryStore.getState().addEntry(entry)
  }
  const onBrowserOnline = () => { setOnline(true); if (!socket.connected) socket.connect() }
  const onBrowserOffline = () => setOnline(false)

  socket.on("connect", onConnect)
  socket.on("disconnect", onDisconnect)
  socket.on("score-update", onScoreUpdate)
  socket.on("match-state", onMatchState)
  socket.on("commentary-update", onCommentaryUpdate)
  browser.on("online", onBrowserOnline)
  browser.on("offline", onBrowserOffline)
  // HTTP scoring can still work when the broadcast socket is disconnected.
  setOnline(browser.online())
  if (socket.connected) join()
  else socket.connect()

  return () => {
    if (cancelled) return
    cancelled = true
    unsubscribe()
    socket.off("connect", onConnect)
    socket.off("disconnect", onDisconnect)
    socket.off("score-update", onScoreUpdate)
    socket.off("match-state", onMatchState)
    socket.off("commentary-update", onCommentaryUpdate)
    browser.off("online", onBrowserOnline)
    browser.off("offline", onBrowserOffline)
    const remaining = (subscriptions.get(matchId) ?? 1) - 1
    if (remaining > 0) subscriptions.set(matchId, remaining)
    else {
      subscriptions.delete(matchId)
      socket.emit("leave-match", { matchId })
    }
  }
}
