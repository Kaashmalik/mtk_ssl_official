import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import { findScoringTenant } from "@/lib/scoring-reads"
import { normalizeDeliveryCommand } from "@mtk/contracts"
import { submitDelivery } from "@/lib/scoring-submission"
import { ScoringRevisionConflict } from "@/lib/scoring-revision-client"

export const dynamic = "force-dynamic"

/**
 * SCORE-08: THE authenticated mobile delivery intake. The native app signs in
 * with Clerk (Expo) and sends `Authorization: Bearer <session-token>`; this
 * route resolves the SAME tenant, match-access gate, actor identity and SoT
 * proxy chain as the recordBall server action — via the shared
 * submitDelivery path. Transport never changes authority:
 * - no service-role or header-trusted caller exists here;
 * - the tenant is resolved server-side from the session, never from the body;
 * - the scoring-service transaction rechecks membership and assignment.
 * Rate limiting and bearer authentication are applied by clerkMiddleware.
 */
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Sign in to score this match" }, { status: 401 })
  }
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) {
    return NextResponse.json({ error: "No active league found for this account" }, { status: 403 })
  }
  await requirePermissionServer("match:score", tenantId)
  const tenant = await findScoringTenant(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: "League is unavailable" }, { status: 403 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "Malformed submission body" }, { status: 400 })
  }

  // ENH-03-02: one validated boundary for both wire generations. The flat
  // boolean command validates directly; the LEGACY nested payload (extras /
  // wicket objects, over/ball aliases) of installed clients is adapted
  // LOSSLESSLY via the shared contracts adapter — never stripped and never
  // mangled: an ambiguous or rich-extra-split payload is refused (400), not
  // guessed. Unknown versions and unknown fields never pass.
  const parsed = normalizeDeliveryCommand(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400 },
    )
  }
  // The schema drops unknown keys, so the queue-bookkeeping guard looks at
  // the RAW body: a mobile submission must not impersonate another
  // account's queue scope in either wire generation.
  if ("queueAccountId" in (raw as object) || "queueTenantId" in (raw as object)) {
    return NextResponse.json(
      { error: "Queue bookkeeping fields are managed by the server session" },
      { status: 403 },
    )
  }

  try {
    const acknowledgement = await submitDelivery(userId, tenant.id, parsed.data)
    revalidatePath(`/matches/${parsed.data.matchId}/scoring`)
    revalidatePath(`/dashboard/matches/${parsed.data.matchId}`)
    revalidatePath("/dashboard/scoring")
    return NextResponse.json(acknowledgement)
  } catch (error) {
    if (error instanceof ScoringRevisionConflict) {
      // SCORE-14: the official score moved. The delivery is NOT accepted and
      // stays queued client-side for review; nobody blind-overwrites.
      return NextResponse.json(
        { code: "SCORING_REVISION_CONFLICT", currentRevision: error.currentRevision, message: error.message },
        { status: 409 },
      )
    }
    const message = error instanceof Error ? error.message : "The delivery was not accepted"
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
