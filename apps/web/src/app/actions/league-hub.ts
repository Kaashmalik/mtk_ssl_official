"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { setHubListing } from "@/lib/hub-listing-settings"

const listingInputSchema = z.boolean()

/**
 * PUB-02 owner hub-listing decision. The caller may only send the boolean;
 * identity and ownership are re-derived server-side and the tenant row is
 * locked inside the writer. Returns the resulting listing state.
 */
export async function updateHubListing(input: unknown) {
  const enable = listingInputSchema.parse(input)
  const result = await setHubListing(enable)
  revalidatePath("/hub")
  revalidatePath("/dashboard/settings")
  return { success: true as const, listed: result.listed, listedAt: result.listedAt, changed: result.changed }
}
