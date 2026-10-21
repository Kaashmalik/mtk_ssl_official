import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { MediaUploadError, getMediaUploadStatus } from "@/lib/media-uploads"

/**
 * GET /api/media/uploads/[sessionId]
 *
 * Reconciliation for an interrupted upload. The upload signature lives in the
 * browser; after a reload this is how the client learns whether that session
 * already produced a ready or quarantined asset. Owner- and tenant-scoped.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    return NextResponse.json(await getMediaUploadStatus({ sessionId }))
  } catch (error) {
    return mediaErrorResponse(error)
  }
}

function mediaErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid upload session" }, { status: 400 })
  }
  if (error instanceof MediaAuthorizationError) {
    const status = error.code === "unauthorized"
      ? 401
      : error.code === "resource_not_found" || error.code === "tenant_not_found"
        ? 404
        : 403
    return NextResponse.json({ error: error.code }, { status })
  }
  if (error instanceof MediaUploadError) {
    const status = error.code === "session_not_found"
      ? 404
      : error.code === "session_not_owner"
        ? 403
        : error.code === "session_expired" || error.code === "session_cancelled"
          ? 409
          : 400
    return NextResponse.json({ error: error.code }, { status })
  }
  return NextResponse.json({ error: "Upload status failed" }, { status: 500 })
}
