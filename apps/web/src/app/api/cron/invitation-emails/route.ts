import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { processInvitationEmailJobs } from "@/lib/invitation-email-queue"

export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try { return NextResponse.json(await processInvitationEmailJobs()) }
  catch { return NextResponse.json({ error: "Invitation dispatch unavailable" }, { status: 503 }) }
}
