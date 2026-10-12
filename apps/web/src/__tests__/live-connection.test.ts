import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Socket } from "socket.io-client"
import { subscribeToLiveMatch } from "@/lib/live-scoring-connection"
import { useScoringStore } from "@/stores/scoring-store"

vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
})
const MATCH = "00000000-0000-4000-8000-000000000001"
function snapshot() {
  return { version: 2, matchId: MATCH, status: "live", currentInnings: 1,
    updatedAt: "2026-10-12T12:00:00.000Z", innings1: {
      matchId: MATCH, innings: 1, inningsId: "00000000-0000-4000-8000-000000000002",
      teamId: "00000000-0000-4000-8000-000000000003", status: "in_progress",
      totalRuns: 0, totalWickets: 0, totalBalls: 0, overs: 0, balls: 0, runRate: 0,
      extras: 0, wides: 0, noBalls: 0, byes: 0, legByes: 0, updatedAt: "2026-10-12T12:00:00.000Z",
    } }
}
function transport() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const browserListeners = new Map<string, () => void>()
  const socket = {
    connected: true, emit: vi.fn(), connect: vi.fn(),
    on: vi.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    }),
    off: vi.fn((event, listener) => listeners.get(event)?.delete(listener)),
  }
  return { socket, listeners, browserListeners,
    receive: (event: string, value?: unknown) => listeners.get(event)?.forEach((listener) => listener(value)),
    browser: { online: () => true, on: vi.fn((event, listener) => browserListeners.set(event, listener)),
      off: vi.fn((event) => browserListeners.delete(event)) },
  }
}

describe("Live connection lifecycle", () => {
  let connection: ReturnType<typeof transport>
  let cleanups: (() => void)[]
  function subscribe() {
    const cleanup = subscribeToLiveMatch(connection.socket as unknown as Socket, MATCH, connection.browser)
    cleanups.push(cleanup)
    return cleanup
  }
  beforeEach(() => {
    connection = transport()
    cleanups = []
    useScoringStore.setState({ matchId: MATCH, matchStatus: "scheduled", matchUpdatedAt: undefined,
      innings1: null, innings2: null, superOver: null })
  })
  afterEach(() => cleanups.forEach((cleanup) => cleanup()))

  it("joins on mount and rejoins on reconnect without re-registering listeners", () => {
    subscribe()
    connection.receive("connect")
    expect(connection.socket.emit.mock.calls.filter(([event]) => event === "join-match")).toHaveLength(2)
    expect(connection.listeners.get("match-state")?.size).toBe(1)
  })
  it("hydrates an empty scoreboard from the initial state event", () => {
    subscribe()
    connection.receive("match-state", snapshot())
    expect(useScoringStore.getState().innings1?.inningsId).toBe(snapshot().innings1.inningsId)
  })
  it("requests complete state for legacy numeric events rather than overwriting extras/status", () => {
    subscribe()
    connection.receive("match-state", snapshot())
    connection.receive("score-update", { matchId: MATCH, totalRuns: 99 })
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(0)
    expect(connection.socket.emit.mock.calls.filter(([event]) => event === "join-match")).toHaveLength(2)
  })
  it("waits for local acknowledgement then asks for a new snapshot", () => {
    subscribe()
    connection.receive("match-state", snapshot())
    const store = useScoringStore.getState()
    store.addBall({ input: 1, runs: 1, overNumber: 0, ballNumber: 1, isWicket: false,
      isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    const localId = useScoringStore.getState().innings1!.balls[0].id
    connection.receive("match-state", snapshot())
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(1)
    store.acknowledgeBall(localId, "server-id", "op-id")
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(1)
    expect(connection.socket.emit.mock.calls.filter(([event]) => event === "join-match")).toHaveLength(2)
  })
  it("removes listeners and leaves even when the join acknowledgement has not arrived", () => {
    const cleanup = subscribe()
    cleanup()
    cleanups = []
    expect(connection.listeners.get("match-state")?.size).toBe(0)
    expect(connection.browserListeners.size).toBe(0)
    expect(connection.socket.emit).toHaveBeenCalledWith("leave-match", { matchId: MATCH })
  })
  it("does not leave a room used by another mounted consumer", () => {
    const first = subscribe()
    subscribe()
    first()
    cleanups.shift()
    expect(connection.socket.emit.mock.calls.filter(([event]) => event === "leave-match")).toHaveLength(0)
  })
  it("does not treat a broadcast-socket disconnect as HTTP/browser offline", () => {
    subscribe()
    connection.receive("disconnect")
    expect(useScoringStore.getState().isOnline).toBe(true)
    connection.browserListeners.get("offline")!()
    expect(useScoringStore.getState().isOnline).toBe(false)
  })
})
