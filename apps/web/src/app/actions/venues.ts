"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requirePermissionServer, resolveActiveTenantId } from "@/lib/rbac-server"
import { createVenueRecord, updateVenueRecord, setVenueActive, venueInput } from "@/lib/venue-writes"

/** Resolve the exact active league and re-check the venue write permission. */
async function mutationTenant() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer("venue:manage", tenantId)
  return { userId, tenantId }
}

export type CreateVenueInput = z.input<typeof venueInput>
export type UpdateVenueInput = z.input<typeof venueInput>

/** Create a venue in the exact active league. */
export async function createVenue(input: CreateVenueInput) {
  const { userId, tenantId } = await mutationTenant()
  const venue = await createVenueRecord(userId, tenantId, venueInput.parse(input))
  revalidatePath("/dashboard/venues")
  revalidatePath("/dashboard")
  return { success: true, venue }
}

/** Update a venue in the exact active league. */
export async function updateVenue(id: string, input: UpdateVenueInput) {
  const { userId, tenantId } = await mutationTenant()
  z.string().uuid().parse(id)
  const venue = await updateVenueRecord(userId, tenantId, id, venueInput.parse(input))
  revalidatePath("/dashboard/venues")
  revalidatePath(`/dashboard/venues/${id}/edit`)
  return { success: true, venue }
}

/** Archive a venue. Compatibility action: it never hard-deletes match history. */
export async function archiveVenue(id: string) {
  const { userId, tenantId } = await mutationTenant()
  z.string().uuid().parse(id)
  const venue = await setVenueActive(userId, tenantId, id, false)
  revalidatePath("/dashboard/venues")
  revalidatePath(`/dashboard/venues/${id}/edit`)
  return { success: true, venue }
}

/** Restore an archived venue. */
export async function restoreVenue(id: string) {
  const { userId, tenantId } = await mutationTenant()
  z.string().uuid().parse(id)
  const venue = await setVenueActive(userId, tenantId, id, true)
  revalidatePath("/dashboard/venues")
  revalidatePath(`/dashboard/venues/${id}/edit`)
  return { success: true, venue }
}
