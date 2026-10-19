import { NextResponse } from "next/server"
import { secretsMatch } from "@/lib/subscription-renewal"
import { chasePendingPushReceipts } from "@/lib/push-receipts"

export const dynamic = "force-dynamic"

/**
 * B163: FAN-02 provider delivery-tracking cron. Same guard discipline as the
 * invitation-emails cron: CRON_SECRET-gated bearer, bounded per run. It
 * closes the push notification loop - send tickets (provider_accepted) become
 * REAL verdicts; not-yet-available receipts stay pending, error receipts
 * downgrade the ledger row, and DeviceNotRegistered deactivates the token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secretsMatch(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await chasePendingPushReceipts())
  } catch {
    return NextResponse.json({ error: "Push receipts chase unavailable" }, { status: 503 })
  }
}
