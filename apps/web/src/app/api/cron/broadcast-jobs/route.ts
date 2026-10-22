import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { processBroadcastJobs } from "@/lib/broadcast-jobs"

export const dynamic = "force-dynamic"

/**
 * ENH-08-01/02: durable broadcast worker trigger.
 *
 * Same guard discipline as the other crons: a CRON_SECRET bearer, a bounded
 * batch per run, and a fail-closed worker gate. Rows are retained while the
 * gate is off; no provider call is made from a user request.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await processBroadcastJobs())
  } catch {
    return NextResponse.json({ error: "Broadcast jobs unavailable" }, { status: 503 })
  }
}
