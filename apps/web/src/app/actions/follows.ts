"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db } from "@mtk/database"
import { fanFollows } from "@mtk/database"
import { eq, and, count } from "drizzle-orm"

type FollowableType = "team" | "player" | "tournament"

export async function followEntity(tenantId: string, followableType: FollowableType, followableId: string) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized — sign in to follow")

  // Check if already following
  const existing = await db.select().from(fanFollows)
    .where(and(
      eq(fanFollows.userId, userId),
      eq(fanFollows.followableType, followableType),
      eq(fanFollows.followableId, followableId),
    )).limit(1)

  if (existing.length > 0) return { success: true, action: "already_following" as const }

  await db.insert(fanFollows).values({
    tenantId,
    userId,
    followableType,
    followableId,
  })

  revalidatePath(`/dashboard/${followableType}s/${followableId}`)
  return { success: true, action: "followed" as const }
}

export async function unfollowEntity(followableType: FollowableType, followableId: string) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  await db.delete(fanFollows).where(and(
    eq(fanFollows.userId, userId),
    eq(fanFollows.followableType, followableType),
    eq(fanFollows.followableId, followableId),
  ))

  revalidatePath(`/dashboard/${followableType}s/${followableId}`)
  return { success: true, action: "unfollowed" as const }
}

export async function isFollowing(followableType: FollowableType, followableId: string): Promise<boolean> {
  const { userId } = await auth()
  if (!userId) return false

  const [result] = await db.select({ total: count() }).from(fanFollows)
    .where(and(
      eq(fanFollows.userId, userId),
      eq(fanFollows.followableType, followableType),
      eq(fanFollows.followableId, followableId),
    ))

  return Number(result.total) > 0
}

export async function getFollowerCount(followableType: FollowableType, followableId: string): Promise<number> {
  const [result] = await db.select({ total: count() }).from(fanFollows)
    .where(and(
      eq(fanFollows.followableType, followableType),
      eq(fanFollows.followableId, followableId),
    ))
  return Number(result.total)
}

export async function getMyFollowing(tenantId: string) {
  const { userId } = await auth()
  if (!userId) return []

  return db.select().from(fanFollows)
    .where(and(eq(fanFollows.userId, userId), eq(fanFollows.tenantId, tenantId)))
    .orderBy(fanFollows.createdAt)
}
