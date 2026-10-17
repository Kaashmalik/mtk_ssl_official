"use client"

import { useState, useTransition } from "react"
import { updateHubListing } from "@/app/actions/league-hub"

/**
 * PUB-02 owner publication control for cross-league hub discoverability.
 * Mirrors the career-consent card: the server action re-derives identity and
 * ownership and locks the tenant row, so this card only reflects the
 * resulting state. Errors are shown, never swallowed, and the control is
 * disabled while the write is in flight so the label always matches the last
 * known decision.
 */

/**
 * Pure label derivations: the copy the card renders is exactly these, so
 * tests assert them without a DOM harness (consistent with the career-consent
 * card; click wiring stays exercised only by tsc).
 */
export function describeHubListing(listed: string, listedAt: string | null): string {
  return listed === "listed"
    ? `Listed${listedAt ? ` — since ${new Date(listedAt).toLocaleDateString()}` : ""}`
    : "Unlisted"
}

export function hubListingControlLabel(listed: string): string {
  return listed === "listed" ? "Remove this league from the public hub" : "List this league on the public hub"
}

export function HubListingCard({ listed, listedAt }: { listed: string; listedAt: string | null }) {
  const [current, setCurrent] = useState({ listed, listedAt })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateHubListing(current.listed !== "listed")
        if (!result.success) {
          setError("The decision could not be saved. Please try again.")
          return
        }
        setCurrent({ listed: result.listed, listedAt: result.listedAt ? String(result.listedAt) : null })
      } catch {
        setError("The decision could not be saved. Please try again.")
      }
    })
  }

  return (
    <section aria-labelledby="hub-listing-heading" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="hub-listing-heading" className="text-lg font-semibold">Public hub discoverability</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your league stays private to its own address unless you list it. Listing allows the cross-league
        hub to show your league name and its already-published competitions and live fixtures only.
        Drafts and cancelled fixtures stay invisible, listing is reversible, and an unlisted link never
        replaces authorization.
      </p>
      <p className="mt-2 text-sm" role="status" aria-live="polite">
        Public hub listing: <strong>{describeHubListing(current.listed, current.listedAt)}</strong>
      </p>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : hubListingControlLabel(current.listed)}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
