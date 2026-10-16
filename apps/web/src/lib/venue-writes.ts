import { randomUUID } from "crypto"
import { db, venues, auditLogs, users, tenants, userTenantRoles, membershipGrantsAccess, type Venue } from "@mtk/database"
import { and, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { isUniqueViolation } from "./db-errors"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const DUPLICATE_NAME = "A venue with that name already exists in this league"

export const venueInput = z.object({
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().max(500).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(120).nullish(),
  country: z.string().trim().max(120).nullish(),
  capacity: z.number().int().min(0).max(1_000_000).nullish(),
  groundType: z.enum(["grass", "synthetic", "concrete", "matting"]).nullish(),
}).strict()

export type VenueWriteInput = z.infer<typeof venueInput>

function lockVenueRow(id: string, tenantId: string) {
  return sql`SELECT ${venues.id} FROM ${venues}
    WHERE ${and(eq(venues.id, id), eq(venues.tenantId, tenantId))} FOR UPDATE`
}

// Venue administration locks account -> league -> membership (league owner only),
// then rechecks the current authority under READ COMMITTED before touching a venue
// row. It never takes a match lock after a venue row, and it never cascades.
async function lockVenueOwnerContext(tx: Tx, clerkId: string, tenantId: string) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: venue account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const member = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
  if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId || !membershipGrantsAccess(member)
    || member.role !== "league_owner") {
    throw new Error("Forbidden: your venue access changed")
  }
  return { actor, league, member }
}

/**
 * Creates a venue in the exact active league as a locked, audited write. The name
 * is unique per league (both a pre-check and the unique-violation catch produce a
 * friendly error); the insert and its audit share one transaction so a failed
 * audit aborts the create.
 */
export async function createVenueRecord(clerkId: string, tenantId: string, values: VenueWriteInput): Promise<Venue> {
  const data = venueInput.parse(values)
  return db.transaction(async (tx) => {
    const context = await lockVenueOwnerContext(tx, clerkId, tenantId)

    const clash = await tx.query.venues.findFirst({ where: and(
      eq(venues.tenantId, tenantId), eq(venues.name, data.name)) })
    if (clash) throw new Error(DUPLICATE_NAME)

    try {
      const [created] = await tx.insert(venues).values({ ...data, tenantId }).returning()
      if (!created) throw new Error("Venue could not be created. Please try again.")
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
        actorRole: context.member.role, method: "VENUE_CREATE", path: "/dashboard/venues",
        statusCode: "200", payload: { resourceId: created.id, changedFields: Object.keys(data) } })
      return created as Venue
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(DUPLICATE_NAME)
      throw error
    }
  }, { isolationLevel: "read committed" })
}

/**
 * Updates a venue in the exact active league as a locked, audited write. The row
 * is locked after the account -> league -> membership locks, the current owner is
 * rechecked after the wait, and a renamed venue is checked for uniqueness. The
 * update and its audit share one transaction.
 */
export async function updateVenueRecord(clerkId: string, tenantId: string, id: string, values: VenueWriteInput): Promise<Venue> {
  z.string().uuid().parse(id)
  const data = venueInput.parse(values)
  return db.transaction(async (tx) => {
    const context = await lockVenueOwnerContext(tx, clerkId, tenantId)
    await tx.execute(lockVenueRow(id, tenantId))

    const existing = await tx.query.venues.findFirst({ where: and(
      eq(venues.id, id), eq(venues.tenantId, tenantId)) })
    if (!existing || existing.id !== id || existing.tenantId !== tenantId) throw new Error("Venue not found")

    if (data.name !== existing.name) {
      const clash = await tx.query.venues.findFirst({ where: and(
        eq(venues.tenantId, tenantId), eq(venues.name, data.name)) })
      if (clash && clash.id !== id) throw new Error(DUPLICATE_NAME)
    }

    try {
      const [updated] = await tx.update(venues).set({ ...data, updatedAt: new Date() })
        .where(and(eq(venues.id, id), eq(venues.tenantId, tenantId))).returning()
      if (!updated) throw new Error("Venue changed. Reload before updating.")
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
        actorRole: context.member.role, method: "VENUE_UPDATE", path: `/dashboard/venues/${id}`,
        statusCode: "200", payload: { resourceId: id, changedFields: Object.keys(data) } })
      return updated as Venue
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(DUPLICATE_NAME)
      throw error
    }
  }, { isolationLevel: "read committed" })
}

/**
 * Archives (isActive = false) or restores a venue. Venues are never hard-deleted:
 * matches reference `venue_id` with ON DELETE SET NULL, so a delete would silently
 * blank historical venue links. An archived venue keeps every match link and can be
 * restored; the change and its audit share one transaction.
 */
export async function setVenueActive(clerkId: string, tenantId: string, id: string, active: boolean): Promise<Venue> {
  z.string().uuid().parse(id)
  return db.transaction(async (tx) => {
    const context = await lockVenueOwnerContext(tx, clerkId, tenantId)
    await tx.execute(lockVenueRow(id, tenantId))

    const existing = await tx.query.venues.findFirst({ where: and(
      eq(venues.id, id), eq(venues.tenantId, tenantId)) })
    if (!existing || existing.id !== id || existing.tenantId !== tenantId) throw new Error("Venue not found")
    if (existing.isActive === active) throw new Error(active ? "Venue is already active" : "Venue is already archived")

    const [updated] = await tx.update(venues).set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(venues.id, id), eq(venues.tenantId, tenantId), ne(venues.isActive, active))).returning()
    if (!updated) throw new Error("Venue changed. Reload before updating.")
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
      actorRole: context.member.role, method: active ? "VENUE_RESTORE" : "VENUE_ARCHIVE",
      path: `/dashboard/venues/${id}`, statusCode: "200", payload: { resourceId: id,
        before: { isActive: existing.isActive }, after: { isActive: active }, changedFields: ["isActive"] } })
    return updated as Venue
  }, { isolationLevel: "read committed" })
}
