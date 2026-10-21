import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { findPublishedMediaDeliveryUrl } from "@/lib/media-records"

/**
 * GET /api/media/[id]/delivery
 *
 * Resolves a published, verified asset to its Cloudinary delivery locator. The
 * redirect is never cached: unpublish/withdraw must take effect immediately and
 * the asset id alone does not grant access to any other lifecycle state.
 *
 * This is public delivery only. Authenticated/entitled/private delivery needs a
 * separate approved design and is not implied by this route.
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
