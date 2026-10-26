import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { purgeExpiredChat } from "@/lib/match-chat-retention"

export const dynamic = "force-dynamic"

/**
 * ENH-10-01: match chat retention trigger.
 *
 * Same guard discipline as the other crons: a CRON_SECRET bearer and a
 * bounded batch per run. The purge is gated by MATCH_CHAT_RETENTION_READY;
 * while the gate is off the route answers 200 with `ran: false` and deletes
 * nothing, so a scheduler can be wired before the owner opts in.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await purgeExpiredChat())
  } catch (error) {
    console.error("[chat-retention] purge failed", error)
    return NextResponse.json({ error: "Chat retention unavailable" }, { status: 503 })
  }
}
