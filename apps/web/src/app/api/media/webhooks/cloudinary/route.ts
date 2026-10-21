import { NextResponse } from "next/server"
import { receiveCloudinaryWebhook } from "@/lib/media-webhook"

export const dynamic = "force-dynamic"

const MAX_WEBHOOK_BYTES = 1_048_576

/**
 * POST /api/media/webhooks/cloudinary
 *
 * Authenticated by Cloudinary's raw-body signature headers, not a session.
 * Verification happens before JSON parsing; a valid poison payload is
 * quarantined and acknowledged, while a bad/stale signature is 401.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }
  const rawBody = await request.text()
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  try {
    const result = await receiveCloudinaryWebhook({
      rawBody,
      timestamp: request.headers.get("x-cld-timestamp"),
      signature: request.headers.get("x-cld-signature"),
    })
    return NextResponse.json(result.body, { status: result.httpStatus })
  } catch {
    // A database failure is transient: let the provider retry.
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 })
  }
}
