import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { readMobileFixtureById } from "@/lib/mobile-reads"

export const dynamic = "force-dynamic"

/**
 * One fixture's member projection (ENH-03-03), under the same single mobile
 * BFF convention as the fixtures feed: Clerk session, server-side tenant,
 * strict MobileFixtureV1 shape. A foreign or missing id is 404 — no signal
 * that a row exists outside the caller's league.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Sign in to read the league" }, { status: 401 })
  }
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) {
    return NextResponse.json({ error: "No active league found for this account" }, { status: 403 })
  }

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "The fixture id must be a league id" }, { status: 400 })
  }

  const fixture = await readMobileFixtureById(tenantId, id)
  if (!fixture) {
    return NextResponse.json({ error: "Fixture not found" }, { status: 404 })
  }
  const response = NextResponse.json(fixture)
  response.headers.set("x-mtk-tenant", tenantId)
  return response
}
