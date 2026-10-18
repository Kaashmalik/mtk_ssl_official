"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { setPublicCareerConsent } from "@/lib/career-records"

const consentInputSchema = z.boolean()

/**
 * Public career consent toggle (PUB-03): the platform user opts in or out of
 * cross-league career linkage. The actor comes from the Clerk session; the
 * caller may only send the boolean decision. Returns the resulting state.
 *
 * PUB-06 cache invalidation: both directions revalidate the public surfaces
 * that render this consent - the leaderboards and the user's public career
 * hub (BOTH grant and withdrawal, so a visited hub cannot keep serving the
 * pre-toggle copy from the client Router Cache).
 */
export async function updatePublicCareerConsent(input: unknown) {
  const consent = consentInputSchema.parse(input)
  const result = await setPublicCareerConsent(consent)
  revalidatePath("/leaderboards")
  revalidatePath(`/hub/players/${result.userId}`)
  return { success: true as const, granted: result.granted, consentedAt: result.consentedAt }
}
