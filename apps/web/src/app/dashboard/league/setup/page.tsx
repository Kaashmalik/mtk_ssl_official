import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import React from "react"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { PlatformContact } from "@/components/support/platform-contact"
import { LeagueSetupForm } from "@/components/league-setup-form"
import { getMyOwnedTenant } from "@/app/actions/tenants"

export default async function LeagueSetupPage() {
  const { userId } = await auth()
  if (!userId) redirect("/")

  // Bounce only accounts that already OWN a league — that is what `createTenant`
  // enforces. `getMyTenant()` (any active membership) used to gate this page,
  // which walled a fan/scorer of one league off from ever creating their own
  // even though the writer allows it. Lookup failures propagate to error.tsx
  // rather than either bouncing or silently showing the form.
  const owned = await getMyOwnedTenant()
  if (owned) redirect("/dashboard")

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Create your league</h1>
          <p className="text-muted-foreground">
            Set up your professional league workspace to start tournaments, teams, and fixtures.
          </p>
        </div>
      </MotionWrapper>
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <LeagueSetupForm />
      </MotionWrapper>
      <MotionWrapper variant="fadeInUp" delay={0.12}>
        {/* ENH-02-04: creation help is one honest tap away; nothing auto-sends. */}
        <PlatformContact context={{ topic: "setup" }} />
      </MotionWrapper>
      <MotionWrapper variant="fadeInUp" delay={0.15}>
        <p className="text-center text-sm text-muted-foreground">
          Need a reviewed onboarding for a larger organization?{" "}
          <Link href="/dashboard/league/apply" className="underline underline-offset-4">
            Submit a league application
          </Link>{" "}
          instead.
        </p>
      </MotionWrapper>
    </div>
  )
}
