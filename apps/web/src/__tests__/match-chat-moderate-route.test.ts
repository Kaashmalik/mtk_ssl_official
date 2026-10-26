import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-10: native moderation route. Only the two supported actions reach the
 * shared writers, the match comes from the path, and authority failures map
 * to 401/403 without leaking internals.
 */

const mocks = vi.hoisted(() => ({ moderate: vi.fn(), mute: vi.fn() }))
vi.mock("@/lib/match-chat", () => ({ moderateChatMessage: mocks.moderate, muteChatUser: mocks.mute }))

const MATCH = "0190a0b0-0000-7000-8000-000000000001"

async function post(body: unknown, matchId = MATCH) {
  const { POST } = await import("../app/api/matches/[matchId]/chat/moderate/route")
  return POST(
    new Request(`http://league.test/api/matches/${matchId}/chat/moderate`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ matchId }) },
  )
}

beforeEach(() => {
  mocks.moderate.mockReset().mockResolvedValue({ ok: true })
  mocks.mute.mockReset().mockResolvedValue({ ok: true })
})

describe("POST /api/matches/[matchId]/chat/moderate", () => {
  it("hides a message in the path's match only", async () => {
    const res = await post({ action: "hide", messageId: "m1", matchId: "other" })
    expect(res.status).toBe(200)
    expect(mocks.moderate).toHaveBeenCalledWith({ matchId: MATCH, messageId: "m1", action: "hide" })
  })

  it("mutes through the shared writer and surfaces its refusals", async () => {
    mocks.mute.mockResolvedValueOnce({ ok: false, error: "You can't mute yourself." })
    const res = await post({ action: "mute", userId: "u1", minutes: 30 })
    expect(res.status).toBe(422)
    expect(mocks.mute).toHaveBeenCalledWith({ matchId: MATCH, userId: "u1", minutes: 30 })
  })

  it("never forwards unsupported actions such as unpin or delete", async () => {
    for (const action of ["unpin", "delete", undefined]) {
      expect((await post({ action, messageId: "m1" })).status).toBe(400)
    }
    expect(mocks.moderate).not.toHaveBeenCalled()
  })

  it("rejects malformed input and bad match ids before any writer runs", async () => {
    expect((await post("nope")).status).toBe(400)
    expect((await post({ action: "hide" }, "not-a-uuid")).status).toBe(404)
    expect(mocks.moderate).not.toHaveBeenCalled()
  })

  it("maps authority failures and hides internals", async () => {
    mocks.moderate.mockRejectedValueOnce(new Error("Forbidden: league access unavailable"))
    expect((await post({ action: "hide", messageId: "m1" })).status).toBe(403)
    mocks.moderate.mockRejectedValueOnce(new Error("Unauthorized"))
    expect((await post({ action: "hide", messageId: "m1" })).status).toBe(401)
    mocks.moderate.mockRejectedValueOnce(new Error("deadlock detected on relation x"))
    const res = await post({ action: "hide", messageId: "m1" })
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain("deadlock")
  })
})
