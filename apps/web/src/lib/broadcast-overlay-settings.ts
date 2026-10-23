import {
  clampGraphicsOffsetMs,
  normalizeGraphicsOffsetValue,
} from "@mtk/contracts"

/**
 * ENH-09-04 (Batch 101): where the overlay graphics offset comes from, and
 * where an operator's calibrated value persists.
 *
 * Priority: an explicit `?offsetMs=` parameter on the token-bound overlay URL
 * wins (it is a deliberate shareable operator configuration), then the
 * operator's last saved value in `localStorage` (an OBS browser source keeps
 * its profile, so a calibration survives restarts), then 0 = today's
 * render-immediately behaviour. Every value passes the same clamp, so a
 * stored or typed value can never push the overlay out of the allowed band.
 *
 * The offset delays ANIMATED EVENTS only (ENH-09-04: match graphics to the
 * broadcast A/V timeline); it never delays reading an official snapshot or
 * any official persistence.
 */

export const OVERLAY_OFFSET_STORAGE_KEY = "ssl.broadcast.overlay.offsetMs"

export type OverlayStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function readOverlayOffsetMs(input: {
  param?: string | null
  storage?: OverlayStorageLike | null
}): number {
  const fromParam = normalizeGraphicsOffsetValue(input.param ?? null)
  if (fromParam != null) return fromParam
  try {
    const stored = input.storage?.getItem(OVERLAY_OFFSET_STORAGE_KEY)
    if (typeof stored === "string" && stored.trim() !== "") {
      return clampGraphicsOffsetMs(stored)
    }
  } catch {
    // A blocked/failed storage read must never break the overlay: fall
    // through to the default.
  }
  return 0
}

/** Persist an operator calibration. Storage failures are ignored on purpose:
 *  the live stream must not depend on a browser quota error. */
export function persistOverlayOffsetMs(value: number, storage?: OverlayStorageLike | null): void {
  try {
    storage?.setItem(OVERLAY_OFFSET_STORAGE_KEY, String(clampGraphicsOffsetMs(value)))
  } catch {
    // Ignore: the in-memory offset still applies for this session.
  }
}
