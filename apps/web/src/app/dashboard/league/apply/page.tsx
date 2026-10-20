import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import React from "react"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { LeagueApplicationForm } from "@/components/league-application-form"
import { getMyOwnedTenant } from "@/app/actions/tenants"
import { getMyLeagueApplication } from "@/app/actions/league-applications"

export default async function LeagueApplicationPage() {
  const { userId } = await auth()
  if (!userId) redirect("/")

  // Owning a league closes this flow the same way it closes league setup:
  // there is no workspace left to apply for. Membership in someone else's
  // league does not (only ownership counts, matching `createTenant`).
  const owned = await getMyOwnedTenant()
  if (owned) redirect("/dashboard")

  const { application, replies } = await getMyLeagueApplication()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Apply for a league</h1>
          <p className="text-muted-foreground">
            For organizations that need a reviewed onboarding. Submit the league details and the platform team
            will review the application before your workspace is activated. Need an instant workspace instead?
            Use the standard league setup.
          </p>
        </div>
      </MotionWrapper>
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <LeagueApplicationForm initialApplication={application} initialReplies={replies} />
      </MotionWrapper>
    </div>
  )
}
