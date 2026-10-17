import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { readPublicCareerProfile } from "@/lib/public-career-profile"

export const metadata = {
  title: "Public career profile",
  description:
    "A person's cross-league cricket career, combined only across leagues that have published themselves to the hub, from published competitions, with the person's explicit consent.",
}

/**
 * PUB-02: the public cross-league career profile. A visitor reaches it only
 * through the shareable link its owner sees on their account page — there is
 * no public directory of profiles. The read is gated by the person's active
 * account + affirmative consent, the league-owner's hub listing decision and
 * the same publication predicates every other public page uses; an
 * ineligible or unknown id is a plain notFound (indistinguishable), and a
 * read failure surfaces an accessible message — nothing partial is exposed.
 *
 * The page deliberately renders NO personal identity (no account name, no
 * email, no roster names): league names and aggregate totals only.
 */
export default async function PublicCareerProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  noStore()
  const { userId } = await params

  let read: Awaited<ReturnType<typeof readPublicCareerProfile>> = null
  let failed = false
  try {
    read = await readPublicCareerProfile(userId)
  } catch {
    failed = true
  }

  if (!read && !failed) notFound()

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold">Cricket career profile</h1>
      <p className="text-sm text-muted-foreground">
        This view combines one person&apos;s published performances across the leagues that have
        chosen to be publicly discoverable, and is shown with that person&apos;s explicit consent.
        Only league names and totals appear here — no personal details. Unlisted leagues never
        contribute, and every league&apos;s own records remain that league&apos;s authority.
      </p>
      {failed && (
        <p role="alert" className="text-destructive">
          This profile could not be loaded. Nothing is exposed while the read is unavailable — please try again.
        </p>
      )}
      {read && !read.complete && (
        <p role="note" className="text-sm">
          Showing the first {read.limit} qualifying leagues; more published leagues contribute to this career.
        </p>
      )}
      {read && read.career.leagues.length === 0 && !failed && (
        <p className="text-sm text-muted-foreground">
          No published performances are currently visible here. Only leagues that have published
          themselves to the hub contribute to this profile.
        </p>
      )}
      {read && read.career.leagues.length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Career totals</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {read.career.totalRunsScored} runs · {read.career.totalWicketsTaken} wickets
              </p>
            </CardContent>
          </Card>
          <table className="w-full text-sm">
            <caption className="sr-only">Published per-league career totals</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">League</th>
                <th scope="col" className="text-right">Runs</th>
                <th scope="col" className="text-right">Wickets</th>
              </tr>
            </thead>
            <tbody>
              {read.career.leagues.map((league) => (
                <tr key={league.tenantId} className="border-b last:border-0">
                  <td className="py-2 font-medium">
                    {league.url ? (
                      <a href={league.url} className="underline underline-offset-4" rel="noopener noreferrer">
                        {league.leagueName}
                      </a>
                    ) : (
                      league.leagueName
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{league.runsScored}</td>
                  <td className="py-2 text-right tabular-nums">{league.wicketsTaken}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
