import { NextResponse } from "next/server"
import { z } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { setMediaPublication } from "@/lib/media-lifecycle"

const schema = z.object({
  action: z.enum(["publish", "unpublish", "withdraw"]),
}).strict()

/**
 * POST /api/media/[id]/publication
 *
 * Publication is server-authoritative: a ready asset is still private, and
 * publish refuses pending/withdrawn consent. Withdrawal is terminal and queues
 * delivery invalidation while retaining the original for rollback; destruction
 * is a separate delete.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid publication command" }, { status: 400 })
  }
  try {
    const result = await setMediaPublication({ assetId: id, action: parsed.data.action })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not_found" ? "Not found" : result.reason },
        { status: result.reason === "not_found" ? 404 : 409 },
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof MediaAuthorizationError) {
      const status = error.code === "unauthorized"
        ? 401
        : error.code === "resource_not_found" || error.code === "tenant_not_found"
          ? 404
          : 403
      return NextResponse.json({ error: error.code }, { status })
    }
    return NextResponse.json({ error: "Publication update failed" }, { status: 503 })
  }
}
