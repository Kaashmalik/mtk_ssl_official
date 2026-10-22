import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { db, users } from "@mtk/database"
import { eq } from "drizzle-orm"
import { isSuperAdmin } from "@/lib/super-admin"
import {
  applyBroadcastAdminAction,
  broadcastAdminActionSchema,
  listBroadcastConnections,
} from "@/lib/broadcast-admin"

/**
 * ENH-08-01: platform-operator broadcast connection/destination seeding.
 *
 * Super-admin only. League owners pick from the approved active destinations;
 * they never handle provider tokens. The route accepts a secret-store
 * reference, never a plaintext token, and read projections omit it.
 */

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isSuperAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(request.url)
  const tenantId = url.searchParams.get("tenantId") ?? undefined
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? Number(limitRaw) : undefined
  if (tenantId && !z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "Invalid tenant" }, { status: 400 })
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 })
  }

  try {
    const connections = await listBroadcastConnections({
      ...(tenantId ? { tenantId } : {}),
      ...(limit ? { limit } : {}),
    })
    return NextResponse.json({ connections })
  } catch {
    return NextResponse.json({ error: "Broadcast connections unavailable" }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isSuperAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = broadcastAdminActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const result = await applyBroadcastAdminAction(actor.id, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("not found")) return NextResponse.json({ error: message }, { status: 404 })
    if (message.includes("refused") || message.includes("unique") || message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: "Broadcast connection action failed" }, { status: 503 })
  }
}
