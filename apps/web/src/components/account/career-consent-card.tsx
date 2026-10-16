"use client"

import { useState, useTransition } from "react"
import { updatePublicCareerConsent } from "@/app/actions/career"

/**
 * Personal PUB-03 consent control. The decision is the person's alone: the
 * server action re-derives identity from the Clerk session and locks the
 * account row, so this card only reflects the resulting state. Errors are
 * shown, never swallowed, and the control is disabled while the write is
 * in flight so the label always matches the last known decision.
 */
/**
 * Pure label derivations: the copy the card renders is exactly these, so
 * tests assert them without a DOM harness (no renderer exists in this
 * suite's stack; the click wiring stays exercised only by tsc — consistent
 * with every other client component here).
 */
export function describeCareerConsent(granted: boolean, consentedAt: string | null): string {
  return granted
    ? `Allowed${consentedAt ? ` — since ${new Date(consentedAt).toLocaleDateString()}` : ""}`
    : "Not allowed"
}

export function consentControlLabel(granted: boolean): string {
  return granted ? "Stop cross-league career linking" : "Allow cross-league career linking"
}

export function CareerConsentCard({ granted, consentedAt }: { granted: boolean; consentedAt: string | null }) {
  const [current, setCurrent] = useState({ granted, consentedAt })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updatePublicCareerConsent(!current.granted)
        if (!result.success) {
          setError("The decision could not be saved. Please try again.")
          return
        }
        setCurrent({ granted: result.granted, consentedAt: result.consentedAt ? String(result.consentedAt) : null })
      } catch {
        setError("The decision could not be saved. Please try again.")
      }
    })
  }

  const decision = describeCareerConsent(current.granted, current.consentedAt)

  return (
    <section aria-labelledby="career-consent-heading" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="career-consent-heading" className="text-lg font-semibold">Public career visibility</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your statistics stay inside each league unless you allow more. This decision governs only
        whether your published, per-league performances may also be combined into one cross-league
        career view. It never changes what any single league already publishes about its own competitions.
      </p>
      <p className="mt-2 text-sm" role="status" aria-live="polite">
        Cross-league career linking: <strong>{decision}</strong>
      </p>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : consentControlLabel(current.granted)}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
