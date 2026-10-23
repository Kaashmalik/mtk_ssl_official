/**
 * ENH-09-04 (Batch 101): pure graphics-latency policy for the OBS overlay.
 *
 * Broadcast latency (ingest → encode → transcode → player) means a graphic
 * that renders the instant an official snapshot lands can appear on stream
 * BEFORE the event it describes is audible/visible in the programme video.
 * The operator therefore may hold the overlay's ANIMATED EVENTS back by an
 * offset they calibrate per production. Two hard rules are encoded here:
 *
 * 1. The offset is a RENDERING delay only. No code path may use it to delay
 *    reading an official snapshot or any official persistence - the scoreboard
 *    numbers still come from the last confirmed snapshot.
 * 2. The offset is bounded and stepped. An junk/out-of-range value clamps
 *    into the allowed band instead of either failing the overlay or
 *    silently accepting an arbitrary delay.
 *
 * Pure: no DOM, no storage, no environment - thin web code applies these
 * decisions to `URLSearchParams`/`localStorage`.
 */

/** Lower bound: 0 = render events as soon as they are planned (today's
 *  behaviour). There is deliberately no negative delay: official truth is
 *  never shown later than reality by guessing forward. */
export const GRAPHICS_OFFSET_MS_MIN = 0
/** Upper bound: beyond 30s an operator is almost certainly misconfiguring
 *  (or trying to build a future-predicting overlay, which this refuses). */
export const GRAPHICS_OFFSET_MS_MAX = 30_000
/** Operator-facing granularity. Coarse steps make the panel usable on a
 *  stream laptop without a keyboard. */
export const GRAPHICS_OFFSET_MS_STEP = 250

/**
 * A snapshot that has not refreshed for this long is treated as STALE for the
 * operator's connection indicator. Deliberately longer than the 5s poll
 * interval (a single missed poll is normal jitter) and short enough that a
 * dropped connection is visible to an operator within seconds.
 */
export const SNAPSHOT_STALE_AFTER_MS = 15_000

/**
 * Clamp an untrusted graphics-offset value (URL param, stored setting) into
 * the allowed band. Non-finite, negative and junk inputs collapse to 0 -
 * rendering must never break because a setting is malformed; out-of-range
 * values clamp to the nearest bound. Fractional values round to the step.
 */
export function clampGraphicsOffsetMs(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN
  if (!Number.isFinite(numeric)) return 0
  const scaled = Math.round(numeric / GRAPHICS_OFFSET_MS_STEP) * GRAPHICS_OFFSET_MS_STEP
  const integer = Math.round(scaled)
  const bounded = Math.min(GRAPHICS_OFFSET_MS_MAX, Math.max(GRAPHICS_OFFSET_MS_MIN, integer))
  // Normalize -0 from the negative-fraction rounding path.
  return bounded === 0 ? 0 : bounded
}

/**
 * Interpret an explicit `offsetMs` search-param value. Returns the clamped
 * value, or `null` when the parameter is absent/empty/unparseable so the
 * caller can fall back to the operator's stored preference instead of
 * treating junk as "no delay".
 */
export function normalizeGraphicsOffsetValue(value: string | undefined | null): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  return clampGraphicsOffsetMs(Number(trimmed))
}
