import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { MediaUploadError, finalizeMediaUpload } from "@/lib/media-uploads"

/**
 * POST /api/media/uploads/[sessionId]/finalize
 *
 * Reads authoritative provider metadata, then either records a ready but
 * UNPUBLISHED asset or quarantines it. Quarantine is a committed evidence row
 * (422), not a transient error; a provider outage never produces "ready".
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    const result = await finalizeMediaUpload({ sessionId })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, detail: result.detail, assetId: result.assetId },
        { status: 422 },
      )
    }
    return NextResponse.json(result)
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
        : error.code === "session_expired"
          || error.code === "session_cancelled"
          || error.code === "already_finalized"
          || error.code === "provider_not_found"
          ? 409
          : error.code === "limits_unconfigured"
            || error.code === "quota_unconfigured"
            || error.code === "provider_unconfigured"
            || error.code === "provider_unavailable"
            ? 503
            : 400
    return NextResponse.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
      { status },
    )
  }
  return NextResponse.json({ error: "Upload finalize failed" }, { status: 500 })
}
