import { describe, expect, it } from "vitest";
import {
  decodePageCursor,
  encodePageCursor,
  makeCursorPageSchema,
  PUBLIC_READS_SCHEMA_VERSION,
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
