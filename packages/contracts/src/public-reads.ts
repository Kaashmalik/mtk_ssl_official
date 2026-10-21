import { MATCH_STATUSES, type MatchStatus } from "./scoring";

/**
 * ENH-03-01: canonical reader envelopes for public and member reads.
 *
 * One cursor codec for web and native — implemented with its own base64url
 * alphabet and hand-rolled UTF-8, because btoa/atob do not exist on native
 * (Hermes) runtimes and Buffer does not exist in browsers. One page envelope
 * with an explicit revision so a consumer can detect a stale page. Scopes
 * are a closed two-value vocabulary: a public projection can never silently
 * widen into a member one.
 */

export const PUBLIC_READS_SCHEMA_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export type ProjectionScope = "public" | "member";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  revision: number;
}

/**
 * Builds a validator for a cursor page whose items are mapped by the given
 * projection. An item the projection refuses fails the WHOLE page: a
 * silently dropped row would fake a truncated league.
 */
export function makeCursorPageSchema<T>(mapItem: (raw: unknown) => T | null) {
  return {
    parse(input: unknown): CursorPage<T> {
      const page = asRecord(input);
      if (!page) throw new Error("A page must be an object");
      const revision = page.revision;
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error("A page revision must be a non-negative integer");
      }
      if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
        throw new Error("A page cursor must be a string or null");
      }
      if (!Array.isArray(page.items)) throw new Error("A page items list must be an array");
      const items: T[] = [];
      for (const raw of page.items) {
        const mapped = mapItem(raw);
        if (mapped === null) throw new Error("A page contained an item the projection refused");
        items.push(mapped);
      }
      return { items, nextCursor: page.nextCursor as string | null, revision };
    },
  };
}

// --- Runtime-neutral base64url ------------------------------------------------

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toUtf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index) as number;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
      index += 1; // surrogate pair consumed
    }
  }
  return bytes;
}

function fromUtf8Bytes(bytes: number[]): string | null {
  let out = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    if (first < 0x80) {
      out += String.fromCharCode(first);
      index += 1;
    } else if (first < 0xe0) {
      const second = bytes[index + 1];
      if (second === undefined || (second & 0xc0) !== 0x80) return null;
      out += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      index += 2;
    } else if (first < 0xf0) {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      if (second === undefined || third === undefined || (second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
        return null;
      }
      out += String.fromCharCode(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      index += 3;
    } else {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      const fourth = bytes[index + 3];
      if (
        second === undefined ||
        third === undefined ||
        fourth === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80
      ) {
        return null;
      }
      const codePoint =
        ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      const offset = codePoint - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      index += 4;
    }
  }
  return out;
}

function bytesToBase64Url(bytes: number[]): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += BASE64URL_ALPHABET[a >> 2];
    out += BASE64URL_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BASE64URL_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BASE64URL_ALPHABET[c & 0x3f];
  }
  return out;
}

function base64UrlToBytes(text: string): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

// --- Canonical cursor -----------------------------------------------------------

export interface PageCursor {
  /** Opaque sort key of the last seen row (e.g. an ISO timestamp or score). */
  sortKey: string;
  /** Unique tiebreaker of the last seen row (never reused between rows). */
  id: string;
}

/** Encodes a cursor as URL-safe, opaque text (one canonical form, everywhere). */
export function encodePageCursor(cursor: PageCursor): string {
  return bytesToBase64Url(toUtf8Bytes(JSON.stringify({ k: cursor.sortKey, i: cursor.id })));
}

/** Decodes a cursor, or null for anything not produced by `encodePageCursor`. */
export function decodePageCursor(cursor: string): PageCursor | null {
  if (typeof cursor !== "string" || cursor.length === 0) return null;
  const bytes = base64UrlToBytes(cursor);
  if (!bytes) return null;
  const json = fromUtf8Bytes(bytes);
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as { k?: unknown; i?: unknown };
    if (typeof parsed.k !== "string" || typeof parsed.i !== "string") return null;
    return { sortKey: parsed.k, id: parsed.i };
  } catch {
    return null;
  }
}

// --- ENH-03-03: the mobile fixtures feed ---------------------------------------

/**
 * The explicit member projection a fixture lands in on the native app: a
 * bounded allowlist with RESOLVED team names — the device never re-hydrates
 * a raw database row (snake_case columns, fabricated names, missing teams).
 * `status` carries the COMPLETE lifecycle vocabulary, including forfeited
 * and postponed, so a native list can never misstate a fixture's state.
 */
export type MobileFixtureV1 = {
  id: string;
  tenantId: string;
  tournamentId: string | null;
  status: MatchStatus;
  /** ISO 8601, or null when the league has not scheduled the fixture. */
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  team1Id: string;
  team2Id: string;
  team1Name: string | null;
  team2Name: string | null;
  winnerId: string | null;
  result: string | null;
  tossWinnerId: string | null;
  tossDecision: "bat" | "bowl" | null;
  liveStreamUrl: string | null;
  streamStatus: "idle" | "live" | "ended" | null;
};

const MATCH_STATUS_SET: ReadonlySet<string> = new Set(MATCH_STATUSES);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableNonEmptyString(value: unknown): boolean {
  return value === null || nonEmptyString(value);
}

/** A strict per-row projection: a raw row, an unknown status or an internal
 *  field fails the WHOLE page instead of being silently mapped or dropped. */
const MOBILE_FIXTURE_FIELDS: ReadonlySet<string> = new Set([
  "id", "tenantId", "tournamentId", "status", "scheduledDate", "startedAt",
  "completedAt", "team1Id", "team2Id", "team1Name", "team2Name", "winnerId",
  "result", "tossWinnerId", "tossDecision", "liveStreamUrl", "streamStatus",
]);
const STREAM_STATUSES: ReadonlySet<string> = new Set(["idle", "live", "ended"]);

function mobileFixtureProjection(raw: unknown): MobileFixtureV1 | null {
  const row = asRecord(raw);
  if (!row) return null;
  if (![row.id, row.tenantId, row.team1Id, row.team2Id].every(nonEmptyString)) return null;
  if (typeof row.status !== "string" || !MATCH_STATUS_SET.has(row.status)) return null;
  if (row.tossDecision !== null && row.tossDecision !== "bat" && row.tossDecision !== "bowl") return null;
  if (row.streamStatus !== null && (typeof row.streamStatus !== "string" || !STREAM_STATUSES.has(row.streamStatus))) return null;
  if (![row.tournamentId, row.scheduledDate, row.startedAt, row.completedAt, row.team1Name,
    row.team2Name, row.winnerId, row.result, row.tossWinnerId, row.liveStreamUrl]
    .every(nullableNonEmptyString)) return null;
  // No internal fields may ride along: the projection is the whole shape.
  for (const key of Object.keys(row)) {
    if (!MOBILE_FIXTURE_FIELDS.has(key)) return null;
  }
  return {
    id: row.id as string, tenantId: row.tenantId as string, tournamentId: row.tournamentId as string | null,
    status: row.status as MatchStatus, scheduledDate: row.scheduledDate as string | null,
    startedAt: row.startedAt as string | null, completedAt: row.completedAt as string | null,
    team1Id: row.team1Id as string, team2Id: row.team2Id as string,
    team1Name: row.team1Name as string | null, team2Name: row.team2Name as string | null,
    winnerId: row.winnerId as string | null, result: row.result as string | null,
    tossWinnerId: row.tossWinnerId as string | null, tossDecision: row.tossDecision as "bat" | "bowl" | null,
    liveStreamUrl: row.liveStreamUrl as string | null, streamStatus: row.streamStatus as "idle" | "live" | "ended" | null,
  };
}

/** Validates a fixtures envelope; an unverifiable item refuses the page. */
export function parseMobileFixturePage(input: unknown): CursorPage<MobileFixtureV1> {
  return makeCursorPageSchema(mobileFixtureProjection).parse(input);
}

export interface MobileFixtureBuckets {
  /** In progress or between innings right now. */
  live: MobileFixtureV1[];
  /** Scheduled or postponed (a postponed fixture is still to be played). */
  upcoming: MobileFixtureV1[];
  /** Terminal with an on-field outcome: completed, abandoned, no-result,
   *  forfeited (a forfeit has a winner and belongs with the results). */
  completed: MobileFixtureV1[];
}

const LIVE_BUCKET_STATUSES: ReadonlySet<string> = new Set(["live", "toss", "innings_break"]);
const UPCOMING_BUCKET_STATUSES: ReadonlySet<string> = new Set(["scheduled", "postponed"]);
const COMPLETED_BUCKET_STATUSES: ReadonlySet<string> = new Set(["completed", "abandoned", "no_result", "forfeited"]);

/**
 * Splits a fixtures feed into the native screen buckets. Every full-status
 * fixture lands in exactly ONE bucket, except cancelled — a terminated
 * fixture is never presented as playable, upcoming or a result anywhere.
 */
export function bucketMobileFixtures(fixtures: readonly MobileFixtureV1[]): MobileFixtureBuckets {
  const buckets: MobileFixtureBuckets = { live: [], upcoming: [], completed: [] };
  for (const fixture of fixtures) {
    if (LIVE_BUCKET_STATUSES.has(fixture.status)) buckets.live.push(fixture);
    else if (UPCOMING_BUCKET_STATUSES.has(fixture.status)) buckets.upcoming.push(fixture);
    else if (COMPLETED_BUCKET_STATUSES.has(fixture.status)) buckets.completed.push(fixture);
  }
  return buckets;
}
