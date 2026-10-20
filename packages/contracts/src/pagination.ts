/**
 * ENH-03-01: portable cursor pagination.
 *
 * One cursor envelope for every paginated list surface (web BFF routes and
 * native reads alike). Request and response cursors share one encoding:
 * a URI-safe JSON envelope with a version, so a cursor minted by one
 * release either decodes cleanly or is rejected - never misread into a
 * wrong page.
 *
 * Implemented WITHOUT node APIs (no Buffer): the encoding is
 * `encodeURIComponent(JSON.stringify(...))`, which is portable across
 * Next server routes, Expo/React Native and plain test runtimes.
 */

export const CURSOR_VERSION = 1 as const

export type CursorPayload = {
  v: typeof CURSOR_VERSION
  /** The last item's stable sort key (id for default orders). */
  after: string
}

/** Encode a payload into an opaque wire cursor; throws on non-string keys. */
export function encodeCursor(payload: CursorPayload): string {
  if (typeof payload.after !== "string" || payload.after.length === 0) {
    throw new Error("encodeCursor: 'after' must be a non-empty string")
  }
  if (payload.v !== CURSOR_VERSION) {
    throw new Error(`encodeCursor: unsupported cursor version ${String(payload.v)}`)
  }
  return encodeURIComponent(JSON.stringify(payload))
}

/**
 * Decode an opaque wire cursor. Returns null for null (end-of-list marker
 * passed through), and throws on anything malformed - a corrupted cursor
 * must fail loudly, not silently rewind to page one (which would duplicate
 * rows and hide the bug).
 */
export function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (cursor === null || cursor === undefined || cursor === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(cursor))
  } catch {
    throw new Error("decodeCursor: cursor is not a valid envelope")
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { v?: unknown }).v !== CURSOR_VERSION ||
    typeof (parsed as { after?: unknown }).after !== "string" ||
    ((parsed as { after?: unknown }).after as string).length === 0
  ) {
    throw new Error("decodeCursor: cursor envelope is malformed or from another version")
  }
  return parsed as CursorPayload
}

/** Build the next page's cursor for settled items, or null when exhausted. */
export function nextPageCursor<T extends { id: string }>(items: T[], limit: number): string | null {
  if (items.length === 0 || items.length < limit) return null
  return encodeCursor({ v: CURSOR_VERSION, after: items[items.length - 1].id })
}

export type CursorPage<T> = {
  items: T[]
  nextCursor: string | null
}

/** Assemble a page from fetched rows and the requested limit. */
export function toCursorPage<T extends { id: string }>(items: T[], limit: number): CursorPage<T> {
  return { items, nextCursor: nextPageCursor(items, limit) }
}
