import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { processNotificationJobs } from "@/lib/notification-jobs"

export const dynamic = "force-dynamic"

/**
 * ENH-06-04: the durable notification worker trigger.
 *
 * Same guard discipline as the invitation-emails and push-receipts crons:
 * CRON_SECRET-gated bearer, bounded per run, and fail-closed while
 * NOTIFICATION_JOBS_READY is off (rows are retained, nothing is claimed).
 * Provider HTTP happens here or in a long-lived worker - never inside the
 * serverless request lifetime that recorded the originating fact.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await processNotificationJobs())
  } catch {
    return NextResponse.json({ error: "Notification jobs unavailable" }, { status: 503 })
  }
}
