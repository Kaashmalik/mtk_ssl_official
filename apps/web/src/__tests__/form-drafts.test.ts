import { describe, expect, it } from "vitest"
import {
  DRAFT_MAX_AGE_MS, draftStorageKey, isPersistableValue, toPersistableValues,
  parseStoredDraft, serializeDraft,
} from "../lib/form-drafts"

const NOW = 1_800_000_000_000
const VALUES = { name: "SSL Premier", maxTeams: "8", official: true, note: null }

describe("Durable form draft policy (UX-03)", () => {
  it("keys drafts per form id and refuses hostile ids", () => {
    expect(draftStorageKey("new-match")).toBe("mtk-form-draft:new-match")
    expect(() => draftStorageKey("../evil")).toThrow()
    expect(() => draftStorageKey("Bad_Id")).toThrow()
  })

  it("persists only the flat JSON-safe subset and names every dropped key", () => {
    expect(isPersistableValue("s")).toBe(true)
    expect(isPersistableValue(3)).toBe(true)
    expect(isPersistableValue(null)).toBe(true)
    expect(isPersistableValue(Number.NaN)).toBe(false)
    expect(isPersistableValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isPersistableValue(new File([], "x"))).toBe(false)
    expect(isPersistableValue({ nested: true })).toBe(false)

    const result = toPersistableValues({ ...VALUES, file: new File([], "x") })
    expect(result).toMatchObject({ ok: true, dropped: ["file"] })
    expect(toPersistableValues(null)).toEqual({ ok: false, reason: "not_an_object" })
    expect(toPersistableValues([VALUES])).toEqual({ ok: false, reason: "not_an_object" })
  })

  it("round-trips a draft with its version and save time", () => {
    const serialized = serializeDraft(VALUES, 3, NOW)
    expect(serialized.ok).toBe(true)
    if (!serialized.ok) return
    const parsed = parseStoredDraft<typeof VALUES>(serialized.raw, 3, NOW)
    expect(parsed).toEqual({ status: "restored", values: VALUES, savedAt: NOW })
  })

  it("discards with a distinct honest reason: missing, unparseable, versioned out, expired, or wrong shape", () => {
    expect(parseStoredDraft(null, 1, NOW)).toEqual({ status: "discarded", reason: "missing" })
    expect(parseStoredDraft("{not json", 1, NOW)).toEqual({ status: "discarded", reason: "unparseable" })
    expect(parseStoredDraft(JSON.stringify([]), 1, NOW)).toEqual({ status: "discarded", reason: "unparseable" })
    const serialized = serializeDraft(VALUES, 1, NOW)
    if (!serialized.ok) throw new Error("serialize failed")
    expect(parseStoredDraft(serialized.raw, 2, NOW))
      .toEqual({ status: "discarded", reason: "version_mismatch" })
    expect(parseStoredDraft(serialized.raw, 1, NOW + DRAFT_MAX_AGE_MS + 1))
      .toEqual({ status: "discarded", reason: "expired" })
    // A draft saved "in the future" is clock tampering or corruption.
    const future = serializeDraft(VALUES, 1, NOW + 60_000)
    if (!future.ok) throw new Error("serialize failed")
    expect(parseStoredDraft(future.raw, 1, NOW))
      .toEqual({ status: "discarded", reason: "invalid_shape" })
    const hostile = JSON.stringify({ version: 1, savedAt: NOW, values: { a: { deep: 1 } } })
    expect(parseStoredDraft(hostile, 1, NOW)).toEqual({ status: "discarded", reason: "invalid_shape" })
  })

  it("declines to serialize an empty persistable set - storing nothing helps nobody", () => {
    expect(serializeDraft({}, 1, NOW)).toEqual({ ok: false, reason: "empty" })
    // A form whose only field is a dropped File persists nothing at all.
    expect(serializeDraft({ file: new File([], "x") }, 1, NOW)).toEqual({ ok: false, reason: "empty" })
  })

  it("keeps a week as the freshness ceiling: older drafts are traps, not helps", () => {
    expect(DRAFT_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
