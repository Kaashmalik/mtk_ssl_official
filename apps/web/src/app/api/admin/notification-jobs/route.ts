import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { isSuperAdmin } from "@/lib/super-admin"
import {
  listNotificationJobDeadLetters,
  resolveNotificationJob,
  retryNotificationJob,
} from "@/lib/notification-jobs-admin"
import { db, users } from "@mtk/database"
import { eq } from "drizzle-orm"

/**
 * ENH-06-04: platform-operator dead-letter surface.
 *
 * Super-admin only (same guard as the other platform admin routes). A tenant
 * filter narrows the head to one league's jobs; account-level jobs are visible
 * only to the unfiltered platform head. Retry/resolve are audited inside the
 * library transaction - this route only authenticates and validates.
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("retry"),
    id: z.string().uuid(),
    tenantId: z.string().uuid().optional(),
  }).strict(),
  z.object({
    action: z.literal("resolve"),
    id: z.string().uuid(),
    tenantId: z.string().uuid().optional(),
    note: z.string().max(200).optional(),
  }).strict(),
])

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
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 })
  }

  try {
    const jobs = await listNotificationJobDeadLetters({ ...(tenantId ? { tenantId } : {}), ...(limit ? { limit } : {}) })
    return NextResponse.json({ jobs })
  } catch {
    return NextResponse.json({ error: "Notification jobs unavailable" }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isSuperAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  // The audit row needs a real platform actor id; the session proves the role,
  // the users row proves the identity we record.
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, userId)).limit(1)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const common = {
    id: parsed.data.id,
    actorId: actor.id,
    actorRole: "super_admin",
    ...(parsed.data.tenantId ? { tenantId: parsed.data.tenantId } : {}),
  }
  try {
    const result = parsed.data.action === "retry"
      ? await retryNotificationJob(common)
      : await resolveNotificationJob({ ...common, ...(parsed.data.note ? { note: parsed.data.note } : {}) })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not_found" ? "Job not found" : "Job is not dead-lettered" },
        { status: result.reason === "not_found" ? 404 : 409 },
      )
    }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "Notification job action failed" }, { status: 503 })
  }
}
