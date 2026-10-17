import {
  draftStorageKey, parseStoredDraft, serializeDraft,
  type PersistableValue,
} from "./form-drafts"

/**
 * UX-03 durable-form draft storage controller (pure, React-free).
 *
 * The framework-facing hook (`use-durable-form-draft`) is a thin shell over
 * this; everything that can be reasoned about - restore-once semantics,
 * discarded-entry cleanup, storage-failure tolerance, versioned clears -
 * lives here so it is testable in a node environment and reusable beyond
 * React. The storage is typed as the minimal Map-like surface so tests can
 * inject a fake instead of a DOM.
 */
export interface DraftStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type DraftRestoreResult<T> =
  | { status: "restored"; values: T; savedAt: number }
  | { status: "idle" }
  | { status: "unusable" }

export function createDurableDraftStore<T extends Record<string, PersistableValue>>(
  options: { storage: DraftStorageLike; formId: string; version: number },
) {
  const key = draftStorageKey(options.formId)
  const { storage, version } = options

  return {
    key,
    /**
     * Restore ONCE semantics. A previously saved, still-valid draft returns
     * with its save time; a discarded (stale/versioned/corrupt) entry is
     * CLEANED UP so its failure cannot recur; any storage access throwing
     * (private mode, disabled) reads as `unusable` - never an exception.
     */
    restore(now: number = Date.now()): DraftRestoreResult<T> {
      try {
        const raw = storage.getItem(key)
        const result = parseStoredDraft<T>(raw, version, now)
        if (result.status === "restored") {
          return { status: "restored", values: result.values, savedAt: result.savedAt }
        }
        if (result.status === "discarded" && result.reason !== "missing") {
          storage.removeItem(key)
        }
        return { status: "idle" }
      } catch {
        return { status: "unusable" }
      }
    },
    /** Persist the draft; false means the storage refused (or nothing persisted). */
    save(values: T, now: number = Date.now()): boolean {
      try {
        const result = serializeDraft(values, version, now)
        if (!result.ok) return false
        storage.setItem(key, result.raw)
        return true
      } catch {
        return false
      }
    },
    /** Wipe the draft (explicit discard or successful submit). Never throws. */
    clear(): void {
      try {
        storage.removeItem(key)
      } catch {
        // Unusable storage has nothing to wipe; staying silent is the truth.
      }
    },
  }
}
