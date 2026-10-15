import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { isSuperAdmin } from "@/lib/super-admin"
import { listAllLeaguesForAdmin } from "@/lib/admin-reads"

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

    const leagues = await listAllLeaguesForAdmin()

    return NextResponse.json({ leagues })
  } catch (error) {
    console.error("Admin leagues API error:", error)
    return NextResponse.json({ error: "Failed to fetch leagues" }, { status: 500 })
  }
}
