import { NextResponse } from "next/server"
import { ZodError, z } from "zod"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { recordMediaConsent } from "@/lib/media-lifecycle"

const schema = z.object({
  state: z.enum(["granted", "withdrawn"]),
  evidenceRef: z.string().min(1).max(200).optional(),
}).strict()

/**
 * POST /api/media/[id]/consent
 *
 * Records asset-level publication consent. Withdrawal is privacy-first: it
 * withdraws publication, tombstones the asset and queues provider destruction
 * (the cleanup worker retains the provider identity).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid consent command" }, { status: 400 })
  }
  try {
    const result = await recordMediaConsent({
      assetId: id,
      state: parsed.data.state,
      ...(parsed.data.evidenceRef ? { evidenceRef: parsed.data.evidenceRef } : {}),
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not_found" ? "Not found" : "Asset is not publishable" },
        { status: result.reason === "not_found" ? 404 : 409 },
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid consent command" }, { status: 400 })
    }
    if (error instanceof MediaAuthorizationError) {
      const status = error.code === "unauthorized"
        ? 401
        : error.code === "resource_not_found" || error.code === "tenant_not_found"
          ? 404
          : 403
      return NextResponse.json({ error: error.code }, { status })
    }
    return NextResponse.json({ error: "Consent update failed" }, { status: 503 })
  }
}
