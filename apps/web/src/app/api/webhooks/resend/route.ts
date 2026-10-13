/**
 * Resend Webhook — records provider delivery events for league invitations.
 *
 * Events recorded: email.delivered → delivered, email.bounced → bounced,
 * email.complained → complained. Everything else is acknowledged and ignored.
 *
 * Security: the Svix signature is verified with RESEND_WEBHOOK_SECRET. The
 * route fails closed (503) when the secret is unset, requires the Svix headers,
 * and never logs the payload (it contains recipient addresses).
 *
 * The matcher in middleware.ts already excludes /api/webhooks from Clerk auth.
 */

export const runtime = "nodejs"

import { NextRequest, NextResponse } from "next/server"
import { Webhook } from "svix"
import { applyInvitationDeliveryEvent } from "@/lib/invitation-delivery"

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  // Fail closed: without a secret we cannot verify, so we must not trust the body.
  if (!secret) {
    return NextResponse.json({ error: "Resend webhook not configured" }, { status: 503 })
  }

  const svixId = req.headers.get("svix-id")
  const svixTimestamp = req.headers.get("svix-timestamp")
  const svixSignature = req.headers.get("svix-signature")
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 })
  }

  // Svix verification needs the raw body, so read it as text before parsing.
  const payload = await req.text()

  let event: { type?: string; data?: unknown }
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type?: string; data?: unknown }
  } catch {
    // Do not log the payload: it contains the recipient address.
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    const result = await applyInvitationDeliveryEvent({ type: event.type, data: event.data })
    return NextResponse.json({ received: true, ...result })
  } catch {
    console.error("[resend-webhook] delivery update failed")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

// Health-check / provider dashboard verification.
export async function GET() {
  return NextResponse.json({ endpoint: "resend-webhook", status: "active" })
}
