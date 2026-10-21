import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { readMobileStandings } from "@/lib/mobile-reads"

export const dynamic = "force-dynamic"

/**
 * The canonical standings for the native app (ENH-03-03), under the one
 * documented mobile BFF convention (`/api/mobile/<resource>`, Clerk session,
 * server-side tenant). The table is computed by the SHARED rule v2 fold —
 * balls-based net run rate, 2/1/0 points, forfeited and postponed fixtures
 * excluded from "played" by the rule — and served with its `ruleVersion` so
 * a client can always tell WHICH rules produced its table. The device never
 * re-derives standings from fixture rows.
 *
 * Without `tournamentId` the table spans the whole active league; with one,
 * it is that competition's table. `revision` is the number of fixtures the
 * table was computed over.
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Sign in to read the league" }, { status: 401 })
  }
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) {
    return NextResponse.json({ error: "No active league found for this account" }, { status: 403 })
  }

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get("tournamentId")
  if (tournamentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) {
    return NextResponse.json({ error: "The tournament filter must be a league id" }, { status: 400 })
  }

  const standings = await readMobileStandings(tenantId, { tournamentId: tournamentId ?? null })
  const response = NextResponse.json(standings)
  response.headers.set("x-mtk-tenant", tenantId)
  return response
}
