import { describe, expect, it } from "vitest"
import { createDurableDraftStore, type DraftStorageLike } from "@/lib/durable-draft-store"
import { draftStorageKey } from "@/lib/form-drafts"

/** Map-backed fake standing in for localStorage: same interface, node-safe. */
function fakeStorage(initial: Record<string, string> = {}): DraftStorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  }
}

const NOW = 1_800_000_000_000
const KEY = draftStorageKey("hook-test")
type Values = Record<string, string>

describe("Durable draft store (UX-03)", () => {
  it("restores once with the save time; an untouched form stays idle", () => {
    const storage = fakeStorage()
    const store = createDurableDraftStore<Values>({ storage, formId: "hook-test", version: 1 })
    expect(store.restore(NOW)).toEqual({ status: "idle" })
    expect(store.save({ name: "SSL Cup", overs: "12" }, NOW)).toBe(true)
    expect(storage.map.get(KEY)).toBeDefined()

    const again = createDurableDraftStore<Values>({ storage, formId: "hook-test", version: 1 })
    expect(again.restore(NOW + 1)).toEqual({ status: "restored", values: { name: "SSL Cup", overs: "12" }, savedAt: NOW })
  })

  it("clears on demand so a successful submit cannot resurrect the draft", () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ version: 1, savedAt: NOW, values: { name: "x" } }) })
    const store = createDurableDraftStore<Values>({ storage, formId: "hook-test", version: 1 })
    store.clear()
    expect(storage.map.has(KEY)).toBe(false)
  })

  it("reports an unusable storage instead of throwing (private mode, quota)", () => {
    const storage: DraftStorageLike = {
      getItem: () => { throw new Error("denied") },
      setItem: () => { throw new Error("quota") },
      removeItem: () => { throw new Error("denied") },
    }
    const store = createDurableDraftStore<Values>({ storage, formId: "hook-test", version: 1 })
    expect(store.restore(NOW)).toEqual({ status: "unusable" })
    expect(store.save({ name: "x" })).toBe(false)
    // clear must never throw even here.
    expect(() => store.clear()).not.toThrow()
  })

  it("cleans up a discarded (stale or versioned-out) entry so the failure cannot recur", () => {
    // Versioned out.
    const versioned = fakeStorage({ [KEY]: JSON.stringify({ version: 99, savedAt: NOW, values: { ancient: "1" } }) })
    const versionedStore = createDurableDraftStore<Values>({ storage: versioned, formId: "hook-test", version: 1 })
    expect(versionedStore.restore(NOW)).toEqual({ status: "idle" })
    expect(versioned.map.has(KEY)).toBe(false)
    // Expired.
    const expired = fakeStorage({ [KEY]: JSON.stringify({ version: 1, savedAt: NOW, values: { name: "old" } }) })
    const expiredStore = createDurableDraftStore<Values>({ storage: expired, formId: "hook-test", version: 1 })
    expect(expiredStore.restore(NOW + 8 * 24 * 60 * 60 * 1000)).toEqual({ status: "idle" })
    expect(expired.map.has(KEY)).toBe(false)
  })

  it("declines to persist a form state with nothing persistable", () => {
    const storage = fakeStorage()
    const store = createDurableDraftStore<Values>({ storage, formId: "hook-test", version: 1 })
    expect(store.save({})).toBe(false)
    expect(storage.map.size).toBe(0)
  })
})
