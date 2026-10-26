import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-10: the chat poll route. Anonymous visitors never see chat, a foreign
 * or unpublished match is indistinguishable from a missing one, malformed
 * cursors never reach the reader, and responses are never cached.
 */

const mocks = vi.hoisted(() => ({ poll: vi.fn() }))

vi.mock("@/lib/match-chat", () => {
  class MatchChatUnavailable extends Error {}
  return { MatchChatUnavailable, pollMatchChat: mocks.poll }
})

const MATCH = "0190a0b0-0000-7000-8000-000000000001"

async function get(path: string, matchId = MATCH) {
  const { GET } = await import("../app/api/matches/[matchId]/chat/route")
  return GET(new Request(`http://league.test${path}`), { params: Promise.resolve({ matchId }) })
}

beforeEach(() => {
  mocks.poll.mockReset()
  mocks.poll.mockResolvedValue({ enabled: true, messages: [], cursor: 0 })
})

describe("GET /api/matches/[matchId]/chat", () => {
  it("404s a malformed match id without reading anything", async () => {
    const res = await get("/api/matches/nope/chat", "nope")
    expect(res.status).toBe(404)
    expect(mocks.poll).not.toHaveBeenCalled()
  })

  it("passes a sanitised cursor and since to the reader and is never cached", async () => {
    const res = await get(`/api/matches/${MATCH}/chat?after=42&since=2026-10-26T12:00:00.000Z`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(mocks.poll).toHaveBeenCalledWith({ matchId: MATCH, after: 42, since: new Date("2026-10-26T12:00:00.000Z") })
  })

  it("treats junk cursors as a fresh load", async () => {
    await get(`/api/matches/${MATCH}/chat?after=-5&since=not-a-date`)
    expect(mocks.poll).toHaveBeenCalledWith({ matchId: MATCH, after: 0, since: null })
    await get(`/api/matches/${MATCH}/chat?after=abc`)
    expect(mocks.poll).toHaveBeenLastCalledWith({ matchId: MATCH, after: 0, since: null })
  })

  it("answers 401 to anonymous visitors and 403 to non-members", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("Unauthorized — sign in to follow"))
    expect((await get(`/api/matches/${MATCH}/chat`)).status).toBe(401)
    mocks.poll.mockRejectedValueOnce(new Error("Forbidden: follow access unavailable"))
    expect((await get(`/api/matches/${MATCH}/chat`)).status).toBe(403)
  })

  it("hides foreign or unpublished rooms behind a 404", async () => {
    const { MatchChatUnavailable } = await import("@/lib/match-chat")
    mocks.poll.mockRejectedValueOnce(new MatchChatUnavailable("x"))
    expect((await get(`/api/matches/${MATCH}/chat`)).status).toBe(404)
  })

  it("never leaks internal errors", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("relation match_chat_messages does not exist"))
    const res = await get(`/api/matches/${MATCH}/chat`)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain("relation")
  })
})

describe("POST /api/matches/[matchId]/chat (native send)", () => {
  const sendMocks = vi.hoisted(() => ({ send: vi.fn() }))

  beforeEach(() => {
    sendMocks.send.mockReset()
  })

  async function post(body: unknown, matchId = MATCH) {
    vi.doMock("@/lib/match-chat", () => {
      class MatchChatUnavailable extends Error {}
      return { MatchChatUnavailable, pollMatchChat: mocks.poll, sendMatchChatMessage: sendMocks.send }
    })
    vi.resetModules()
    const { POST } = await import("../app/api/matches/[matchId]/chat/route")
    return POST(
      new Request(`http://league.test/api/matches/${matchId}/chat`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ matchId }) },
    )
  }

  it("takes the match from the path and never forwards a pin request", async () => {
    sendMocks.send.mockResolvedValue({ ok: true, message: { id: "m1" } })
    const res = await post({ matchId: "someone-else", body: "hi", clientKey: "k", pin: true })
    expect(res.status).toBe(200)
    expect(sendMocks.send).toHaveBeenCalledWith({ matchId: MATCH, body: "hi", clientKey: "k", replyToId: null })
  })

  it("rejects malformed bodies before the writer runs", async () => {
    for (const body of ["not json", "[1,2]", "null"]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(sendMocks.send).not.toHaveBeenCalled()
  })

  it("answers policy refusals with 422 and a Retry-After for timed ones", async () => {
    sendMocks.send.mockResolvedValue({ ok: false, reason: "slow_mode", retryAfterSeconds: 7, error: "Slow mode" })
    const res = await post({ body: "hi", clientKey: "k" })
    expect(res.status).toBe(422)
    expect(res.headers.get("Retry-After")).toBe("7")
  })

  it("maps identity failures to 401/403 and hides internal errors", async () => {
    sendMocks.send.mockRejectedValueOnce(new Error("Unauthorized — sign in"))
    expect((await post({ body: "hi", clientKey: "k" })).status).toBe(401)
    sendMocks.send.mockRejectedValueOnce(new Error("Forbidden: no league"))
    expect((await post({ body: "hi", clientKey: "k" })).status).toBe(403)
    sendMocks.send.mockRejectedValueOnce(new Error("connection refused at 10.0.0.5"))
    const res = await post({ body: "hi", clientKey: "k" })
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5")
  })
})
