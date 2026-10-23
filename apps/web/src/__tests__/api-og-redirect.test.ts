import { describe, expect, it } from "vitest"

/**
 * Batch 126: the legacy /api/og/match/[id] route is retired. It duplicated
 * the canonical per-match OG image (the file-convention route at
 * /matches/[matchId]/opengraph-image) as a second, divergent generator that
 * hardcoded the platform brand. Direct links to the legacy URL — possibly
 * already shared externally — get a permanent 308 redirect to the canonical
 * image; anything that is not a plausible match id gets a plain 404 rather
 * than echoing hostile input into a Location header.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeRequest(path = "https://ssl.example.com/api/og/match/x"): Request {
  return new Request(path)
}

describe("Legacy /api/og/match redirect (Batch 126)", () => {
  it("permanently redirects a valid match id to the canonical OG image route", async () => {
    const { GET } = await import("../app/api/og/match/[id]/route")
    const id = "0f0f0f0f-1111-4222-8333-444455556666"
    const response = await GET(makeRequest(), { params: Promise.resolve({ id }) }) as Response
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toBe(
      "https://ssl.example.com/matches/0f0f0f0f-1111-4222-8333-444455556666/opengraph-image",
    )
  })

  it("a hostile or malformed id is a plain 404 — never echoed into a Location header", async () => {
    const { GET } = await import("../app/api/og/match/[id]/route")
    for (const hostile of ["..%2F..%2F", "javascript:alert(1)", "not-a-uuid", ""]) {
      const response = await GET(makeRequest(), { params: Promise.resolve({ id: hostile }) }) as Response
      expect(response.status).toBe(404)
      expect(response.headers.get("location")).toBeNull()
    }
  })

  it("every accepted id is a strict uuid", async () => {
    expect(UUID_RE.test("0f0f0f0f-1111-4222-8333-444455556666")).toBe(true)
    expect(UUID_RE.test("javascript:alert(1)")).toBe(false)
    expect(UUID_RE.test("..%2F..%2F")).toBe(false)
    expect(UUID_RE.test("")).toBe(false)
  })
})
