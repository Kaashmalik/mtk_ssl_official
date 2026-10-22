import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { broadcastControlEnabled, readBroadcastDestinations } from "@/lib/broadcast-sessions"
import { BroadcastSettings } from "@/components/settings/broadcast-settings"

export const metadata = {
  title: "Live broadcast",
}

/**
 * ENH-08-01: league-owner view of approved provider destinations.
 *
 * This surface is read-mostly by design. Tokens, OAuth refresh material and
 * ingest keys never appear here; a platform operator seeds connections through
 * the super-admin route.
 */
export default async function BroadcastSettingsPage() {
  noStore()
  const { userId } = await auth()
  if (!userId) redirect("/")

  const context = await requireActiveLeagueContext("settings:manage")
  const enabled = broadcastControlEnabled()
  let destinations: Awaited<ReturnType<typeof readBroadcastDestinations>> = []
  let unavailable = false
  if (enabled) {
    try {
      destinations = await readBroadcastDestinations(context.tenantId)
    } catch {
      unavailable = true
    }
  }

  return (
    <div className="space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Live broadcast</h1>
        <p className="mt-1 text-muted-foreground">
          Approved provider destinations for this league.{" "}
          <Link href="/dashboard/settings" className="text-primary underline underline-offset-4">
            Back to settings
          </Link>
        </p>
      </MotionWrapper>

      {!enabled && (
        <MotionWrapper variant="fadeInUp" delay={0.05}>
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            The verified broadcast control plane is not enabled in this environment. Manual
            Studio/Live Producer links remain available. Enable it only after the broadcast
            migration has been applied and provider credentials are provisioned.
          </div>
        </MotionWrapper>
      )}
      {unavailable && (
        <MotionWrapper variant="fadeInUp" delay={0.05}>
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Broadcast destinations are temporarily unavailable. Nothing was changed.
          </div>
        </MotionWrapper>
      )}
      {enabled && !unavailable && (
        <MotionWrapper variant="fadeInUp" delay={0.08}>
          <BroadcastSettings destinations={destinations} />
        </MotionWrapper>
      )}
    </div>
  )
}
