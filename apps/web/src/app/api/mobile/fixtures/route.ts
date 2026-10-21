import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { readMobileFixtures, parseMobilePageCursor } from "@/lib/mobile-reads"

export const dynamic = "force-dynamic"

/**
 * THE mobile fixtures feed (ENH-03-03). The native app reads the league
 * through this BFF — never through raw Supabase rows from the device.
 *
 * The one documented mobile BFF convention: member reads live under
 * `/api/mobile/<resource>`, authenticate with the Clerk session, resolve the
 * tenant SERVER-SIDE (the query's `tenantId` is deliberately ignored — it
 * can never widen the read), and return the shared contracts `CursorPage`
 * envelope (`items` of the strict MobileFixtureV1 projection, `nextCursor`
 * for keyset pagination, `revision` = tenant fixture count as a staleness
 * signal, plus the `x-mtk-tenant` response header). An alternative version
 * prefix requires ADR review.
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

  let cursor
  try {
    cursor = parseMobilePageCursor(url.searchParams.get("cursor"))
  } catch {
    return NextResponse.json({ error: "The page cursor is not usable" }, { status: 400 })
  }

  const page = await readMobileFixtures(tenantId, { tournamentId: tournamentId ?? null, cursor })
  const response = NextResponse.json(page)
  response.headers.set("x-mtk-tenant", tenantId)
  return response
}
