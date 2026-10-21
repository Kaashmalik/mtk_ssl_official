import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { deleteMediaAsset } from "@/lib/media-lifecycle"

/**
 * DELETE /api/media/[id]
 *
 * Tombstones the asset and queues provider destruction. The row is retained;
 * this route never hard-deletes provider identity.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const result = await deleteMediaAsset({ assetId: id })
    if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid asset" }, { status: 400 })
    }
    if (error instanceof MediaAuthorizationError) {
      const status = error.code === "unauthorized"
        ? 401
        : error.code === "resource_not_found" || error.code === "tenant_not_found"
          ? 404
          : 403
      return NextResponse.json({ error: error.code }, { status })
    }
    return NextResponse.json({ error: "Media delete failed" }, { status: 503 })
  }
}
