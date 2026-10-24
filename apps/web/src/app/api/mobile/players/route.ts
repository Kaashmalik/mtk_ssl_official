import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import {
  parseMemberDirectoryListQuery,
  readMemberPlayer,
  readMemberPlayers,
} from "@/lib/mobile-bff"
import { MOBILE_BFF_ROUTES, MOBILE_BFF_VERSION, isUuid } from "@mtk/contracts"

export const dynamic = "force-dynamic"

/**
 * ENH-03-03 wave 2: the league's player directory for the native app -
 * bearer authenticated, session-scoped league (same contract as teams).
 * The old anonymous read joined `teams(name)` across ALL leagues.
 *
 * `?teamId=<uuid>` narrows to one roster; `?playerId=<uuid>` returns one
 * player with their per-tournament `seasonStats` embedded.
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
  const playerId = url.searchParams.get("playerId")
  const teamId = url.searchParams.get("teamId")
  for (const id of [playerId, teamId]) {
    if (id !== null && !isUuid(id)) {
      return NextResponse.json({ error: "invalid_query", detail: "ids must be uuids" }, { status: 400 })
    }
  }

  if (playerId !== null) {
    const player = await readMemberPlayer({ tenantId, playerId })
    return NextResponse.json(
      { items: player ? [player] : [], nextCursor: null, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.players },
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

  const page = await readMemberPlayers({ tenantId, teamId, query: parsed.query })
  return NextResponse.json(
    { ...page, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.players },
    { headers: { "Cache-Control": "no-store" } },
  )
}
