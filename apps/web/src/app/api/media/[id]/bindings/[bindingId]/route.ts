import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { unbindMediaAsset } from "@/lib/media-bindings"

/**
 * DELETE /api/media/[id]/bindings/[bindingId]
 *
 * Removes one attachment. The asset and the provider object are untouched;
 * deleting media is a separate destructive command.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id, bindingId } = await params
  try {
    const result = await unbindMediaAsset({ assetId: id, bindingId })
    if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
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
    return NextResponse.json({ error: "Unbind failed" }, { status: 503 })
  }
}
