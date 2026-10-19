import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { db, pushTokens, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

export const dynamic = "force-dynamic"

/**
 * B162: mobile push-token intake — the ONLY write path for push_tokens.
 *
 * Same transport discipline as the SCORE-08 scoring intake: the device talks
 * ONLY to the web app; requests ride clerkMiddleware and authenticate via the
 * Clerk session bearer token (Authorization: Bearer <session-token>). There
 * is no dev bypass and no anonymous registration: a push token must always
 * be attributable to a real signed-in account (push_tokens.user_id is NOT
 * NULL by schema, and a forged user_id is impossible — it is taken from the
 * verified session, never from the body).
 *
 * One endpoint serves both directions of the token lifecycle:
 *   - { token, platform?, deviceId? }            -> register / re-activate
 *   - { token, active: false }                   -> deregister (soft)
 * Tokens are upserted on (user_id, token); a re-registration refreshes
 * platform/device metadata and last_used_at instead of duplicating rows.
 */

const registrationSchema = z.object({
  // Expo push tokens look like ExponentPushToken[xxxxxxxx...]; anything else
  // would be unsendable, so it is refused rather than stored.
  token: z.string().regex(/^ExponentPushToken\[[\w-]+\]$/, "Not an Expo push token"),
  platform: z.enum(["ios", "android"]).nullable().default(null),
  deviceId: z.string().min(1).max(128).nullable().default(null),
  active: z.boolean().default(true),
})

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsed: z.infer<typeof registrationSchema>
  try {
    parsed = registrationSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid registration payload" }, { status: 400 })
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)

  if (!user) {
    // A Clerk session without a synced platform account row: refuse honestly
    // instead of orphaning a token.
    return NextResponse.json({ error: "Account not provisioned" }, { status: 403 })
  }

  await db
    .insert(pushTokens)
    .values({
      userId: user.id,
      token: parsed.token,
      platform: parsed.platform,
      deviceId: parsed.deviceId,
      isActive: parsed.active,
      lastUsedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pushTokens.userId, pushTokens.token],
      set: {
        platform: parsed.platform,
        deviceId: parsed.deviceId,
        isActive: parsed.active,
        lastUsedAt: new Date(),
      },
    })

  return NextResponse.json({ registered: parsed.active })
}

/** Soft-delete convenience: deregister this device's token. */
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  let token: unknown
  try {
    token = (await req.json())?.token
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }
  const parsed = z.string().min(8).max(255).safeParse(token)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 })
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)
  if (!user) {
    return NextResponse.json({ error: "Account not provisioned" }, { status: 403 })
  }

  await db
    .update(pushTokens)
    .set({ isActive: false, lastUsedAt: new Date() })
    .where(and(eq(pushTokens.userId, user.id), eq(pushTokens.token, parsed.data)))

  return NextResponse.json({ registered: false })
}
