import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { parseMemberMatchListQuery, readMemberMatch, readMemberMatchPage } from "@/lib/mobile-bff"
import { MOBILE_BFF_ROUTES, MOBILE_BFF_VERSION } from "@mtk/contracts"

export const dynamic = "force-dynamic"

/**
 * ENH-03-03: THE authenticated native matches read. Bearer-authenticated by
 * clerkMiddleware like the scoring intake; the tenant is resolved from the
 * session (never from a query param the device sent), so a stale or forged
 * tenant id on the wire is structurally impossible and a league switch on
 * the web is reflected here on the very next page. Responses are contracts
 * member projections over cursor pagination - no raw rows, no truncation.
 *
 * `?matchId=<uuid>` returns one member projection (list envelope with zero
 * or one items) for the native detail screen; otherwise this is the paged
 * list read.
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const tenantId = await resolveActiveTenantId()
  if (!tenantId) {
    return NextResponse.json({ error: "no_active_league" }, { status: 403 })
  }

  const url = new URL(request.url)
  const matchId = url.searchParams.get("matchId")
  if (matchId !== null) {
    if (!/^[0-9a-fA-F-]{36}$/.test(matchId)) {
      return NextResponse.json({ error: "invalid_query", detail: "matchId must be a uuid" }, { status: 400 })
    }
    const match = await readMemberMatch({ userId, tenantId, matchId })
    return NextResponse.json(
      { items: match ? [match] : [], nextCursor: null, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.matches },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  const parsed = parseMemberMatchListQuery({
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
    status: url.searchParams.get("status"),
    teamId: url.searchParams.get("teamId"),
  })
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error }, { status: 400 })
  }

  const page = await readMemberMatchPage({ userId, tenantId, query: parsed.query })
  return NextResponse.json(
    { ...page, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.matches },
    { headers: { "Cache-Control": "no-store" } },
  )
}
