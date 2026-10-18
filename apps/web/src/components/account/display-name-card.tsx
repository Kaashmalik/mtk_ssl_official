"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { updateMyDisplayName } from "@/app/actions/users"
import { describeDisplayName } from "@mtk/database/lib/profile-policy"

// The card's copy convention: the pure describe fn is re-exported from the
// card module so tests (and any future i18n surface) assert exactly what renders.
export { describeDisplayName }

/**
 * REG-05 (Batch 142): the display-name card. Personal surface (outside the
 * league RBAC matrix, mirroring the timezone/consent cards): the server
 * action re-derives identity from the Clerk session and locks the account
 * row, so this card only reflects the resulting state. Errors are shown,
 * never swallowed, and the control is disabled while the write is in
 * flight. Copy follows the career-consent-card convention: the rendered
 * text is exactly the pure describe function, so tests assert it without a
 * DOM harness (i18n for personal-account cards is recorded future work).
 */
export function DisplayNameCard({ displayName }: { displayName: string | null }) {
  const [current, setCurrent] = useState(displayName)
  const [draft, setDraft] = useState(displayName ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateMyDisplayName({ displayName: draft })
        setCurrent(result.displayName)
        setDraft(result.displayName ?? "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the display name")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Display name</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{describeDisplayName(current)}</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="How your name shows across leagues"
            aria-label="Display name"
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
            disabled={pending}
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-9 rounded-md border px-3 text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Saving" : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  )
}
