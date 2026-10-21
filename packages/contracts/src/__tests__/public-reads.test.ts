import { describe, expect, it } from "vitest";
import {
  bucketMobileFixtures,
  decodePageCursor,
  encodePageCursor,
  makeCursorPageSchema,
  parseMobileFixturePage,
  PUBLIC_READS_SCHEMA_VERSION,
  type MobileFixtureV1,
  type ProjectionScope,
} from "../public-reads";

/**
 * ENH-03-01: canonical reader envelopes. One cursor codec for web and
 * native (own base64url alphabet — btoa/atob do NOT exist on Hermes/native
 * runtimes), one page envelope, and explicit projection scopes so a public
 * read can never silently be widened.
 */

describe("ENH-03-01: cursor page envelope", () => {
  const pageSchema = makeCursorPageSchema(
    // A minimal item schema standing in for a real projection.
    (raw: unknown) => (typeof raw === "string" ? { ok: true, value: raw } : null),
  );

  it("is versioned", () => {
    expect(PUBLIC_READS_SCHEMA_VERSION).toBe(1);
  });

  it("validates a real page with items and a next cursor", () => {
    const parsed = pageSchema.parse({ items: ["a", "b"], nextCursor: "eye", revision: 7 });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.revision).toBe(7);
  });

  it("accepts a terminal page with a null cursor and empty items", () => {
    const parsed = pageSchema.parse({ items: [], nextCursor: null, revision: 3 });
    expect(parsed.nextCursor).toBeNull();
  });

  it("refuses negative revisions and unknown item shapes", () => {
    expect(() => pageSchema.parse({ items: ["a"], nextCursor: null, revision: -1 })).toThrow();
    expect(() => pageSchema.parse({ items: [42], nextCursor: null, revision: 1 })).toThrow();
  });

  it("only understands public and member scopes", () => {
    const scopes: ProjectionScope[] = ["public", "member"];
    expect(scopes).toEqual(["public", "member"]);
  });
});

describe("ENH-03-01: cursor codec (runtime-neutral base64url)", () => {
  it("round-trips a sort key and id", () => {
    const cursor = encodePageCursor({ sortKey: "2026-10-20T09:00:00.000Z", id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
    expect(decodePageCursor(cursor)).toEqual({
      sortKey: "2026-10-20T09:00:00.000Z",
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
  });

  it("produces URL-safe characters only", () => {
    const cursor = encodePageCursor({ sortKey: "a+b/c=d", id: "x" });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("refuses tampered or garbage cursors", () => {
    expect(decodePageCursor("!!!not-base64!!!")).toBeNull();
    // Valid base64url, but not the envelope shape.
    expect(decodePageCursor(encodePageCursor({ sortKey: "k" } as never))).toBeNull();
    const wrongEnvelope = encodePageCursor({ sortKey: "k", id: "i" }).slice(0, -2);
    expect(decodePageCursor(`${wrongEnvelope}xx`)).toBeNull();
  });
});

describe("ENH-03-03: the mobile fixtures feed vocabulary", () => {
  const fixture: MobileFixtureV1 = {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    tenantId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    tournamentId: null,
    status: "postponed",
    scheduledDate: "2026-10-20T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    team1Id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    team2Id: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
    team1Name: "Alpha XI",
    team2Name: "Beta XI",
    winnerId: null,
    result: null,
    tossWinnerId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    tossDecision: "bat",
    liveStreamUrl: null,
    streamStatus: "idle",
  };

  it("parses a page of fixtures through the shared envelope", () => {
    const page = parseMobileFixturePage({
      items: [fixture, { ...fixture, id: "3f2504e0-4f89-41d3-9a0c-0305e82c3305", status: "forfeited" }],
      nextCursor: null,
      revision: 2,
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0].status).toBe("postponed");
    expect(page.items[1].status).toBe("forfeited");
    expect(page.revision).toBe(2);
  });

  it("refuses a page that carries a raw, unprojected row", () => {
    // A raw database row (snake_case, unknown statuses, extra internals)
    // must fail the page, not be silently mapped into the canonical shape.
    expect(() => parseMobileFixturePage({
      items: [{ ...fixture, scheduled_date: fixture.scheduledDate }],
      nextCursor: null, revision: 1,
    })).toThrow();
    expect(() => parseMobileFixturePage({
      items: [{ ...fixture, status: "mysterious" }],
      nextCursor: null, revision: 1,
    })).toThrow();
    expect(() => parseMobileFixturePage({
      items: [{ ...fixture, streamStatus: "recording" }],
      nextCursor: null, revision: 1,
    })).toThrow();
    expect(() => parseMobileFixturePage({
      items: [{ ...fixture, createdBy: "internal-user" }],
      nextCursor: null, revision: 1,
    })).toThrow();
  });

  it("buckets every full-status fixture exactly once or deliberately nowhere", () => {
    const statuses = ["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "cancelled", "no_result", "forfeited", "postponed"] as const;
    const all = statuses.map((status, index) => ({ ...fixture, id: `id-${index}`, status }));
    const buckets = bucketMobileFixtures(all);
    const bucketed = [...buckets.live, ...buckets.upcoming, ...buckets.completed];
    // Every status lands in exactly one bucket except cancelled, which is a
    // terminated fixture and is deliberately surfaced nowhere as playable.
    expect(bucketed).toHaveLength(9);
    expect(buckets.live.map((f) => f.status).sort()).toEqual(["innings_break", "live", "toss"]);
    expect(buckets.upcoming.map((f) => f.status).sort()).toEqual(["postponed", "scheduled"]);
    expect(buckets.completed.map((f) => f.status).sort()).toEqual(["abandoned", "completed", "forfeited", "no_result"]);
    expect(all.filter((f) => !bucketed.includes(f)).map((f) => f.status)).toEqual(["cancelled"]);
  });
});
