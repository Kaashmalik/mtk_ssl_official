"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PersistableValue } from "./form-drafts"
import { createDurableDraftStore } from "./durable-draft-store"

/**
 * UX-03 durable-form draft hook (per-browser localStorage convenience).
 *
 * A thin React shell over the node-testable `createDurableDraftStore`:
 * restores ONCE on mount (`draft` + `restoredAt` let the form hydrate and
 * SHOW the banner - never a silent overwrite), saves on demand, clears on
 * submit or explicit discard. Storage failures (private mode, quota) surface
 * as `storageUsable: false` instead of errors; the draft holds no authority -
 * server truth always wins on submit.
 */
export function useDurableFormDraft<T extends Record<string, PersistableValue>>(
  formId: string,
  version: number,
) {
  const [draft, setDraft] = useState<T | null>(null)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [storageUsable, setStorageUsable] = useState(true)
  const didRestore = useRef(false)

  useEffect(() => {
    if (didRestore.current) return
    didRestore.current = true
    const store = createDurableDraftStore<T>({ storage: window.localStorage, formId, version })
    const result = store.restore()
    if (result.status === "restored") {
      setDraft(result.values)
      setRestoredAt(result.savedAt)
    } else if (result.status === "unusable") {
      setStorageUsable(false)
    }
  }, [formId, version])

  const saveDraft = useCallback((values: T) => {
    const store = createDurableDraftStore<T>({ storage: window.localStorage, formId, version })
    if (!store.save(values)) setStorageUsable(false)
  }, [formId, version])

  const clearDraft = useCallback(() => {
    const store = createDurableDraftStore<T>({ storage: window.localStorage, formId, version })
    store.clear()
    setDraft(null)
    setRestoredAt(null)
  }, [formId])

  const dismissRestored = useCallback(() => {
    // The user saw the banner and kept editing: stop showing it this session,
    // but keep the persisted draft - it stays their work until submit.
    setDraft(null)
    setRestoredAt(null)
  }, [])

  return { draft, restoredAt, storageUsable, saveDraft, clearDraft, dismissRestored }
}
