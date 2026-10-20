import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import {
  parseMemberDirectoryListQuery,
  readMemberTeam,
  readMemberTeams,
} from "@/lib/mobile-bff"
import { MOBILE_BFF_ROUTES, MOBILE_BFF_VERSION } from "@mtk/contracts"

export const dynamic = "force-dynamic"

/**
 * ENH-03-03 wave 2: the league's team directory for the native app. Bearer
 * authenticated; the league comes from the session - the old anonymous
 * `select` showed EVERY league's teams to everyone (cross-tenant leak);
 * members now see exactly their league's roster directory.
 *
 * `?teamId=<uuid>` returns one team (list envelope, zero or one items).
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
  const teamId = url.searchParams.get("teamId")
  if (teamId !== null) {
    if (!/^[0-9a-fA-F-]{36}$/.test(teamId)) {
      return NextResponse.json({ error: "invalid_query", detail: "teamId must be a uuid" }, { status: 400 })
    }
    const team = await readMemberTeam({ tenantId, teamId })
    return NextResponse.json(
      { items: team ? [team] : [], nextCursor: null, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.teams },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  const parsed = parseMemberDirectoryListQuery({
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  })
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error }, { status: 400 })
  }

  const page = await readMemberTeams({ tenantId, query: parsed.query })
  return NextResponse.json(
    { ...page, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.teams },
    { headers: { "Cache-Control": "no-store" } },
  )
}
