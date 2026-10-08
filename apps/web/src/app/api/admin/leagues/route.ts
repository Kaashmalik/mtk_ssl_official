import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { db } from "@mtk/database"
import { tenants } from "@mtk/database"
import { desc } from "drizzle-orm"
import { isSuperAdmin } from "@/lib/super-admin"

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const isAdmin = await isSuperAdmin()
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const leagues = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        customDomain: tenants.customDomain,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt))

    return NextResponse.json({ leagues })
  } catch (error) {
    console.error("Admin leagues API error:", error)
    return NextResponse.json({ error: "Failed to fetch leagues" }, { status: 500 })
  }
}
