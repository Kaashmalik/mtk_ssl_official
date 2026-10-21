import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { expireStaleMediaUploadSessions, processMediaCleanupJobs } from "@/lib/media-cleanup"

export const dynamic = "force-dynamic"

/**
 * ENH-07-03: media maintenance trigger.
 *
 * Same guard discipline as the other crons. Expiry reconciliation is DB-only
 * and always runs; provider destruction is gated by MEDIA_CLEANUP_READY so an
 * unapproved Cloudinary account never receives deletion calls. Jobs are
 * retained while the gate is off.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const expired = await expireStaleMediaUploadSessions()
    const cleanup = await processMediaCleanupJobs()
    return NextResponse.json({ expired, cleanup })
  } catch {
    return NextResponse.json({ error: "Media maintenance unavailable" }, { status: 503 })
  }
}
