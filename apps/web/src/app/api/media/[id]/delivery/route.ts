import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { findPublishedMediaDeliveryUrl } from "@/lib/media-records"

/**
 * GET /api/media/[id]/delivery
 *
 * Resolves a published, verified asset to a Cloudinary locator. Originals are
 * stored with the `authenticated` delivery type, so the locator is a signed URL
 * minted per request that expires within minutes; unpublish/withdraw therefore
 * takes effect without chasing leaked provider URLs. The redirect is never
 * cached and the asset id alone does not grant access to any other lifecycle
 * state.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const url = await findPublishedMediaDeliveryUrl(id)
    if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid asset" }, { status: 400 })
    }
    return NextResponse.json({ error: "Delivery unavailable" }, { status: 503 })
  }
}
