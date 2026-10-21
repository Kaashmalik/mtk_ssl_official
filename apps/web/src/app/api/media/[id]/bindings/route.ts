import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { bindMediaAsset } from "@/lib/media-bindings"

/**
 * POST /api/media/[id]/bindings
 *
 * Attaches a verified, ready asset to a domain resource. Binding does not
 * publish; publication stays behind the consent/publication gate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  try {
    const result = await bindMediaAsset(id, body)
    if (!result.ok) {
      const status = result.reason === "not_found"
        ? 404
        : result.reason === "role_not_allowed"
          ? 400
          : 409
      return NextResponse.json({ error: result.reason }, { status })
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid binding" }, { status: 400 })
    }
    if (error instanceof MediaAuthorizationError) {
      const status = error.code === "unauthorized"
        ? 401
        : error.code === "resource_not_found" || error.code === "tenant_not_found"
          ? 404
          : 403
      return NextResponse.json({ error: error.code }, { status })
    }
    return NextResponse.json({ error: "Binding failed" }, { status: 503 })
  }
}
