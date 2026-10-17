import React from "react"
import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { readMyCareerConsent } from "@/lib/career-records"
import { readMyCareerHub } from "@/lib/career-hub"
import { CareerConsentCard } from "@/components/account/career-consent-card"

/**
 * Personal account surface (PUB-03/PUB-02). Deliberately OUTSIDE the league
 * RBAC matrix: the consent decision belongs to the person, not to any
 * league role, so the only gates are the Clerk session and the account's
 * own activity (checked by both readers). No tenant context is required.
 */
export default async function AccountPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Both readers fail closed on an inactive/unavailable account; the
  // boundary reason is the same message the writer enforces, never a
  // silent empty state.
  const [consent, hubResult] = await Promise.all([
    readMyCareerConsent(),
    readMyCareerHub().then(
      (hub) => ({ ok: true as const, hub }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ])

  return (
    <div className="max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <Link href="/dashboard" className="inline-flex min-h-11 items-center underline">Back to dashboard</Link>
      {!hubResult.ok ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Your public career</h2>
          <p role="alert" className="mt-2 text-sm text-destructive">
            Your career view is temporarily unavailable. Please try again later.
          </p>
        </section>
      ) : (
        <>
          <CareerConsentCard granted={consent.granted} consentedAt={consent.consentedAt ? consent.consentedAt.toISOString() : null} />
          <section aria-labelledby="career-hub-heading" className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 id="career-hub-heading" className="text-lg font-semibold">Your public career</h2>
            {!hubResult.hub.consented ? (
              <p className="mt-2 text-sm text-muted-foreground">
                While linking is not allowed, your statistics stay inside each league and this
                career view stays empty.
              </p>
            ) : hubResult.hub.career && hubResult.hub.career.leagues.length > 0 ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Totals across leagues, built only from competitions those leagues have published.
                  Each league keeps its own records; this fold never changes them.
                </p>
                <table className="mt-4 w-full text-sm">
                  <caption className="sr-only">Your published per-league career totals</caption>
                  <thead><tr><th scope="col" className="text-left">League</th><th scope="col" className="text-right">Runs</th><th scope="col" className="text-right">Wickets</th></tr></thead>
                  <tbody>
                    {hubResult.hub.career.leagues.map((league) => (
                      <tr key={league.tenantId} className="border-b last:border-0">
                        <td className="py-2 font-medium">{hubResult.hub.leagues.find((l) => l.tenantId === league.tenantId)?.leagueName ?? league.tenantId}</td>
                        <td className="py-2 text-right tabular-nums">{league.runsScored}</td>
                        <td className="py-2 text-right tabular-nums">{league.wicketsTaken}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2">Career total</td>
                      <td className="py-2 text-right tabular-nums">{hubResult.hub.career.totalRunsScored}</td>
                      <td className="py-2 text-right tabular-nums">{hubResult.hub.career.totalWicketsTaken}</td>
                    </tr>
                  </tbody>
                </table>
                {hubResult.hub.profilePath && (
                  <p className="mt-3 text-sm">
                    With linking allowed, this career is also on the public hub at{" "}
                    <Link href={hubResult.hub.profilePath} className="underline underline-offset-4">
                      your shareable profile link
                    </Link>
                    . It shows league names and totals only — never your account name, email or
                    roster names — and only leagues that have published themselves to the hub.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No published performances are linked to your account yet. League stats appear here
                once a league has published competitions with you in them.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
