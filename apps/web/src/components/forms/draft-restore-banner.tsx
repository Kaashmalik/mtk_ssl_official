"use client"

import { Button } from "@mtk/ui/components/ui/button"

/** Deterministic UTC presentation for the draft restore banner. */
function formatDraftTime(savedAt: number): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(savedAt))} UTC`
}

/**
 * UX-03 durable-form restore banner. Restoration is NEVER silent: the user is
 * told their draft came back, exactly when it was saved, and is given a
 * one-click honest discard. Dismiss keeps editing (the draft stays persisted
 * for later), Discard wipes it and it will not come back.
 */
export function DraftRestoreBanner({
  restoredAt,
  onDiscard,
  onDismiss,
}: {
  restoredAt: number
  onDiscard: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
      data-testid="draft-restore-banner"
    >
      <span>
        Draft restored from <strong>{formatDraftTime(restoredAt)}</strong> - review before submitting.
      </span>
      <span className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}
          aria-label="Discard the restored draft and reset the form">
          Discard
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}
          aria-label="Keep the restored draft and continue">
          Keep
        </Button>
      </span>
    </div>
  )
}
