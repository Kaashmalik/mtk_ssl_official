import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { proxyRecordBall, proxyUndoBall, proxyCreateInnings, proxyCompleteInnings, proxyCompleteMatch } from "@/lib/scoring-service-client"

const TENANT = "00000000-0000-7000-8000-000000000001"
const ACTOR = "00000000-0000-7000-8000-000000000006"
const MATCH = "00000000-0000-4000-8000-000000000002"
const command = { matchId: MATCH, inningsId: MATCH, clientOpId: "op", over: 0, ball: 1, runs: 0, batsmanId: MATCH, bowlerId: MATCH }
const calls = [
  { name: "delivery", run: (tenant = TENANT, actor = ACTOR) => proxyRecordBall(command, tenant, actor) },
  { name: "undo", run: (tenant = TENANT, actor = ACTOR) => proxyUndoBall(MATCH, MATCH, tenant, actor) },
  { name: "create innings", run: (tenant = TENANT, actor = ACTOR) => proxyCreateInnings({ matchId: MATCH, teamId: MATCH, inningsNumber: 1 }, tenant, actor) },
  { name: "complete innings", run: (tenant = TENANT, actor = ACTOR) => proxyCompleteInnings(MATCH, MATCH, tenant, actor) },
  { name: "complete match", run: (tenant = TENANT, actor = ACTOR) => proxyCompleteMatch(MATCH, { winnerId: MATCH, result: "Won", manOfMatchId: MATCH }, tenant, actor) },
]
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubEnv("SCORING_SERVICE_TOKEN", " internal-test-secret ")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, matchId: MATCH, status: "completed" }) })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("Server-only scoring actor transport", () => {
  it.each(calls)("$name sends trusted tenant, actor, and internal token only as headers", async ({ run }) => {
    await run()
    const request = fetchMock.mock.calls[0][1]
    expect(request.headers.get("x-tenant-id")).toBe(TENANT)
    expect(request.headers.get("x-scoring-actor-id")).toBe(ACTOR)
    expect(request.headers.get("x-scoring-service-token")).toBe("internal-test-secret")
    expect(request.cache).toBe("no-store")
    const payload = JSON.parse(request.body)
    expect(payload).not.toHaveProperty("actorId")
    expect(payload).not.toHaveProperty("serviceToken")
  })
  it.each(calls)("$name never sends an unprovisioned Clerk identity as actor", async ({ run }) => {
    await expect(run(TENANT, "user_clerk")).rejects.toThrow("actor UUID")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(calls)("$name fails before transport when credentials are missing", async ({ run }) => {
    vi.stubEnv("SCORING_SERVICE_TOKEN", " ")
    await expect(run()).rejects.toThrow("token is not configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("does not retry or acknowledge a canonical assignment rejection", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ message: "Assignment revoked" }) })
    await expect(proxyRecordBall(command, TENANT, ACTOR)).rejects.toThrow("Assignment revoked")
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it("rejects a missing tenant before transport", async () => {
    await expect(proxyUndoBall(MATCH, MATCH, "", ACTOR)).rejects.toThrow("requires a tenantId")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("sends the canonical completion route with the optional award and no actor in the body", async () => {
    await proxyCompleteMatch(MATCH, { winnerId: MATCH, result: "Won", manOfMatchId: MATCH }, TENANT, ACTOR)
    expect(fetchMock.mock.calls[0][0]).toContain(`/scoring/match/${MATCH}/complete`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ winnerId: MATCH, result: "Won", manOfMatchId: MATCH })
  })
  it.each([{}, { success: false, matchId: MATCH, status: "completed" },
    { success: true, matchId: TENANT, status: "completed" }, { success: true, matchId: MATCH, status: "live" }])(
    "rejects a malformed or mismatched completion acknowledgement %s", async response => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => response })
      await expect(proxyCompleteMatch(MATCH, { result: "Won" }, TENANT, ACTOR)).rejects.toThrow("did not acknowledge")
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )
})
