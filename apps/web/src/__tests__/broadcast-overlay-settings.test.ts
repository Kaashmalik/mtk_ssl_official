import { describe, expect, it } from "vitest"
import {
  OVERLAY_OFFSET_STORAGE_KEY,
  persistOverlayOffsetMs,
  readOverlayOffsetMs,
  type OverlayStorageLike,
} from "@/lib/broadcast-overlay-settings"

/**
 * ENH-09-04 (Batch 101): the graphics-offset setting resolution. URL param
 * wins, stored calibration next, 0 by default; nothing un-clamped, and
 * storage failures never break the overlay.
 */

function fakeStorage(initial: Record<string, string> = {}, fail = false): OverlayStorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => {
      if (fail) throw new Error("storage blocked")
      return map.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (fail) throw new Error("storage blocked")
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe("Batch 101: overlay graphics-offset settings", () => {
  it("prefers an explicit URL parameter over the stored calibration", () => {
    const storage = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "5000" })
    expect(readOverlayOffsetMs({ param: "2500", storage })).toBe(2_500)
    expect(readOverlayOffsetMs({ param: "0", storage })).toBe(0)
  })

  it("falls back to the stored calibration, clamped", () => {
    const storage = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "7500" })
    expect(readOverlayOffsetMs({ storage })).toBe(7_500)
    // A corrupted/stale stored value must clamp, not zero or crash.
    const junk = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "yesterday" })
    expect(readOverlayOffsetMs({ storage: junk })).toBe(0)
    const outOfBand = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "999999" })
    expect(readOverlayOffsetMs({ storage: outOfBand })).toBe(30_000)
    const negative = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "-250" })
    expect(readOverlayOffsetMs({ storage: negative })).toBe(0)
  })

  it("defaults to 0 with nothing configured and treats junk params as absent", () => {
    expect(readOverlayOffsetMs({})).toBe(0)
    expect(readOverlayOffsetMs({ param: "suv", storage: fakeStorage() })).toBe(0)
    // An explicit junk param must NOT look like "the operator set 0": fall
    // back to storage (documented as null-normalization upstream).
    const storage = fakeStorage({ [OVERLAY_OFFSET_STORAGE_KEY]: "4000" })
    expect(readOverlayOffsetMs({ param: "", storage })).toBe(4_000)
  })

  it("persists the calibration and ignores storage failures", () => {
    const storage = fakeStorage()
    persistOverlayOffsetMs(3_000, storage)
    expect(storage.map.get(OVERLAY_OFFSET_STORAGE_KEY)).toBe("3000")
    // Clamped on write too.
    persistOverlayOffsetMs(99_999, storage)
    expect(storage.map.get(OVERLAY_OFFSET_STORAGE_KEY)).toBe("30000")
    // A quota error must not throw - the session's in-memory offset still applies.
    const broken = fakeStorage({}, true)
    expect(() => persistOverlayOffsetMs(1_000, broken)).not.toThrow()
    expect(() => persistOverlayOffsetMs(1_000, null)).not.toThrow()
    expect(() => readOverlayOffsetMs({ storage: broken })).not.toThrow()
  })
})
