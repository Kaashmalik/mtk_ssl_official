import { NextResponse } from "next/server"
import { z } from "zod"
import { broadcastOverlaySecret, verifyBroadcastOverlayToken } from "@/lib/broadcast-overlay-token"
import { readBroadcastOverlaySnapshot } from "@/lib/broadcast-overlay-reads"

/**
 * GET /api/broadcast/overlay/[broadcastId]/snapshot?token=...
 *
 * Token-bound, read-only, no-store. Publication is rechecked in the read on
 * every call, so an unpublish/withdraw takes effect on the next poll even while
 * an OBS browser source stays open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ broadcastId: string }> },
) {
  const { broadcastId } = await params
  const token = new URL(request.url).searchParams.get("token") ?? ""
  let payload
  try {
    payload = verifyBroadcastOverlayToken(token, broadcastOverlaySecret())
  } catch {
    return NextResponse.json({ error: "Overlay unavailable" }, { status: 503 })
  }
  if (!payload || payload.matchId !== broadcastId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const snapshot = await readBroadcastOverlaySnapshot({
      tenantId: payload.tenantId,
      matchId: payload.matchId,
    })
    if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(snapshot, {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ error: "Overlay unavailable" }, { status: 503 })
  }
}
