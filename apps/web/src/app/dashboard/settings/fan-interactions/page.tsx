import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Badge } from "@mtk/ui/components/ui/badge"
import { unstable_noStore as noStore } from "next/cache"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { readLeagueOpenReports } from "@/lib/fan-report-records"
import { readActiveFanBlocks } from "@/lib/fan-block-records"
import { FanInteractionsManager } from "@/components/settings/fan-interactions-manager"
import { MatchChatSettings } from "@/components/settings/match-chat-settings"
import { hasPermission } from "@/lib/rbac"
import { readLeagueChatSettings, readOpenChatReports } from "@/lib/match-chat"

export const metadata = {
  title: "Fan interactions",
}

/**
 * The league-wide fan-moderation queue (FAN-01 completion). Reports and
 * blocks were previously visible only per match - this surface makes the
 * loop REVIEWABLE in one place. It adds visibility only: every decision and
 * lift goes through the identical locked writer actions, which re-check the
 * owner gate server-side on every call.
 */
export default async function FanInteractionsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Owner-gated exactly like the per-match moderation surface
  // (match:update, not settings:manage - moderation authority, not settings).
  const league = await requireActiveLeagueContext("match:update")

  // Fail closed to empty queues - a read failure is never a page failure.
  let reports: Awaited<ReturnType<typeof readLeagueOpenReports>> = []
  let blocks: Awaited<ReturnType<typeof readActiveFanBlocks>> = []
  try {
    reports = await readLeagueOpenReports()
  } catch {
    reports = []
  }
  try {
    blocks = await readActiveFanBlocks()
  } catch {
    blocks = []
  }
  // ENH-10: chat controls appear only for owners who may change settings.
  const canManageChat = hasPermission(league.role, "settings:manage")
  let chatSettings = { enabled: false, slowModeSeconds: 10 }
  let chatReports: Awaited<ReturnType<typeof readOpenChatReports>> = []
  if (canManageChat) {
    try {
      chatSettings = await readLeagueChatSettings(league.tenantId)
    } catch {
      // Fail closed: show chat as off rather than guess.
    }
    try {
      chatReports = await readOpenChatReports()
    } catch {
      chatReports = []
    }
  }

  return (
    <div className="space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Fan interactions</h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={reports.length > 0 ? "default" : "outline"}>
            {reports.length} open report{reports.length === 1 ? "" : "s"}
          </Badge>
          <Badge variant={blocks.length > 0 ? "default" : "outline"}>
            {blocks.length} blocked fan{blocks.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          Review fan reports on match reaction feeds and manage blocked fans
          across the whole league.{" "}
          <Link href="/dashboard/settings" className="text-primary underline underline-offset-4">
            Back to settings
          </Link>
        </p>
      </MotionWrapper>

      <MotionWrapper variant="fadeInUp" delay={0.05}>
        <FanInteractionsManager initialReports={reports} initialBlocks={blocks} />
      </MotionWrapper>

      {canManageChat && (
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <MatchChatSettings initialSettings={chatSettings} initialReports={chatReports} />
        </MotionWrapper>
      )}
    </div>
  )
}
