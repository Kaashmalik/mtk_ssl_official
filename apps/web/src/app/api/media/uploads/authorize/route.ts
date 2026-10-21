import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { MediaUploadError, authorizeMediaUpload } from "@/lib/media-uploads"

/**
 * POST /api/media/uploads/authorize
 *
 * Returns ONE signed upload request plus the session id that finalize will
 * accept. The body is a declaration - bytes/mime/duration are ceilings checked
 * against deployment limits and, after upload, against authoritative provider
 * metadata. No public URL is minted here.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  try {
    const result = await authorizeMediaUpload(body)
    return NextResponse.json(result)
  } catch (error) {
    return mediaErrorResponse(error)
  }
}

function mediaErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid upload declaration" }, { status: 400 })
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
    const status = error.code === "invalid_request"
      ? 400
      : error.code === "quota_exceeded" || error.code === "already_finalized"
        ? 409
        : error.code === "limits_unconfigured"
          || error.code === "quota_unconfigured"
          || error.code === "provider_unconfigured"
          ? 503
          : 400
    return NextResponse.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
      { status },
    )
  }
  return NextResponse.json({ error: "Upload authorization failed" }, { status: 500 })
}
