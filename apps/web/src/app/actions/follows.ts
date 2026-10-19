"use server"

import { revalidatePath } from "next/cache"
import type { FanFollowType } from "@/lib/fan-follows"
import {
  followFanEntity, unfollowFanEntity, isFanFollowing, getFanFollowerCount, getMyFollowingFanEntities,
} from "@/lib/fan-follows"

/** Follow a team/player/tournament in the exact active league as the signed-in account. */
export async function followEntity(tenantId: string, followableType: FanFollowType, followableId: string) {
  const result = await followFanEntity(tenantId, followableType, followableId)
  revalidatePath(`/dashboard/${followableType}s/${followableId}`)
  return { success: true, action: result.action }
}

export async function unfollowEntity(followableType: FanFollowType, followableId: string) {
  const result = await unfollowFanEntity(followableType, followableId)
  revalidatePath(`/dashboard/${followableType}s/${followableId}`)
  return { success: true, action: result.action }
}

export async function isFollowing(followableType: FanFollowType, followableId: string) {
  return isFanFollowing(followableType, followableId)
}

export async function getFollowerCount(followableType: FanFollowType, followableId: string) {
  return getFanFollowerCount(followableType, followableId)
}

/** The signed-in account's follows in the active league; the tenant is resolved server-side. */
export async function getMyFollowing() {
  return getMyFollowingFanEntities()
}
