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
