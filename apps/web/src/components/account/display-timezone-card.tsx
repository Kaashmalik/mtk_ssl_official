"use client"

import { useState, useTransition } from "react"
import { updateMyDisplayTimeZone } from "@/app/actions/users"
import { DISPLAY_TIME_ZONE_OPTIONS } from "@/lib/time-policy"

/**
 * UX-03 display-timezone control. Personal surface (outside the league RBAC
 * matrix, mirroring PUB-03 consent): the server action re-derives identity
 * from the Clerk session and locks the account row, so this card only
 * reflects the resulting state. Errors are shown, never swallowed, and the
 * control is disabled while the write is in flight.
 *
 * Pure label derivation follows the career-consent-card convention: the copy
 * the card renders is exactly this function, so tests assert it without a
 * DOM harness (the change wiring stays exercised only by tsc).
 */
export function describeDisplayTimeZone(timeZone: string | null): string {
  return timeZone
    ? `Dates and times show in ${timeZone}.`
    : "Dates and times show in UTC (default). You can change this below."
}

export function DisplayTimezoneCard({ timeZone }: { timeZone: string | null }) {
  const [current, setCurrent] = useState(timeZone)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const commit = (zone: string | null) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateMyDisplayTimeZone({ timeZone: zone })
        if (!result.success) {
          setError("The timezone could not be saved. Please try again.")
          return
        }
        setCurrent(result.timeZone)
      } catch {
        setError("The timezone could not be saved. Please try again.")
      }
    })
  }

  return (
    <section aria-labelledby="display-timezone-heading" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="display-timezone-heading" className="text-lg font-semibold">Display timezone</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Match times on your dashboard render in this timezone. Leave it unset and everything stays
        in UTC - the server&apos;s timezone is never assumed to be yours.
      </p>
      <p className="mt-2 text-sm" role="status" aria-live="polite">
        <strong>{describeDisplayTimeZone(current)}</strong>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          aria-label="Display timezone"
          disabled={pending}
          value={current ?? ""}
          onChange={(event) => commit(event.target.value === "" ? null : event.target.value)}
          className="min-h-11 rounded-md border bg-background px-3 text-sm disabled:opacity-60"
        >
          <option value="">UTC (default)</option>
          {DISPLAY_TIME_ZONE_OPTIONS.filter((zone) => zone !== "UTC").map((zone) => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </select>
        {pending && <span className="text-sm text-muted-foreground">Saving…</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
