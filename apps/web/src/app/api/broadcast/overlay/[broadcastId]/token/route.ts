import { NextResponse } from "next/server"
import { z } from "zod"
import { db, matches } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { requireMediaMember, MediaAuthorizationError } from "@/lib/media-authorization"
import { hasPermission } from "@/lib/rbac"
import { broadcastOverlaySecret, signBroadcastOverlayToken } from "@/lib/broadcast-overlay-token"

/**
 * POST /api/broadcast/overlay/[broadcastId]/token
 *
 * Mints a short-lived, read-only OBS overlay URL for a league owner/scoped
 * match manager. The secret never leaves the server. There is no public token
 * listing and no token that can mutate a match.
 */

const bodySchema = z.object({
  ttlSeconds: z.number().int().min(60).max(12 * 60 * 60).optional(),
}).strict()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ broadcastId: string }> },
) {
  const { broadcastId } = await params
  let actor
  try {
    actor = await requireMediaMember()
  } catch (error) {
    if (error instanceof MediaAuthorizationError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!hasPermission(actor.role, "match:update")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const input = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!input.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const [match] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.id, broadcastId), eq(matches.tenantId, actor.tenantId)))
    .limit(1)
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const secret = broadcastOverlaySecret()
    const ttlSeconds = input.data.ttlSeconds ?? 4 * 60 * 60
    const token = signBroadcastOverlayToken({
      tenantId: actor.tenantId,
      matchId: match.id,
      ttlSeconds,
    }, secret)
    const origin = new URL(request.url).origin
    const path = `/broadcast/overlay/${match.id}?token=${encodeURIComponent(token)}`
    return NextResponse.json({
      path,
      url: `${origin}${path}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
    }, {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    })
  } catch {
    return NextResponse.json({ error: "Overlay is not configured" }, { status: 503 })
  }
}
