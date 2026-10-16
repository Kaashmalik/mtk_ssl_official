import React from "react"
import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { readMyCareerConsent } from "@/lib/career-records"
import { CareerConsentCard } from "@/components/account/career-consent-card"

/**
 * Personal account surface (PUB-03). Deliberately OUTSIDE the league
 * RBAC matrix: the consent decision belongs to the person, not to any
 * league role, so the only gates are the Clerk session and the account's
 * own activity (checked by the reader). No tenant context is required.
 */
export default async function AccountPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Fails closed on an inactive/unavailable account; the boundary reason is
  // the same message the writer enforces, never a silent empty state.
  const consent = await readMyCareerConsent()

  return (
    <div className="max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <Link href="/dashboard" className="inline-flex min-h-11 items-center underline">Back to dashboard</Link>
      <CareerConsentCard granted={consent.granted} consentedAt={consent.consentedAt ? consent.consentedAt.toISOString() : null} />
    </div>
  )
}
