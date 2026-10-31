import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { resolveMemberTenantId } from "@/lib/rbac-server"
import { eq } from "drizzle-orm"
import { db, tenants } from "@mtk/database"
import { parseMemberDirectoryListQuery, readAnnouncements } from "@/lib/mobile-bff"
import { MOBILE_BFF_ROUTES, MOBILE_BFF_VERSION } from "@mtk/contracts"

export const dynamic = "force-dynamic"

/**
 * ENH-03-03 wave 2: platform announcements for the native news screen.
 * The ONE deliberately public BFF route: it works signed-out (audience
 * `all` only); a signed-in member additionally receives plan-matched and
 * tenant-targeted announcements (their league and plan are resolved from
 * the session, never from the device).
 */
export async function GET(request: Request) {
  let tenantId: string | null = null
  let tenantPlan: string | null = null
  try {
    const { userId } = await auth()
    if (userId) {
      tenantId = await resolveMemberTenantId(userId)
      if (tenantId) {
        const [tenant] = await db
          .select({ plan: tenants.plan })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
        tenantPlan = tenant?.plan ?? null
      }
    }
  } catch {
    // A missing/invalid session degrades to the public view - never a 500.
  }

  const url = new URL(request.url)
  const parsed = parseMemberDirectoryListQuery({
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  })
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error }, { status: 400 })
  }

  const page = await readAnnouncements({ tenantId, tenantPlan, query: parsed.query })
  return NextResponse.json(
    { ...page, version: MOBILE_BFF_VERSION, route: MOBILE_BFF_ROUTES.announcements },
    { headers: { "Cache-Control": "no-store" } },
  )
}
