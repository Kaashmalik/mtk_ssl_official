import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { db, users, tenants, auditLogs } from "@mtk/database"
import {
  HUB_UNLISTED,
  hubListingEligible,
  hubListingTransition,
  type HubListingStatus,
} from "@mtk/database/lib/public-hub-policy"
import { and, eq, sql } from "drizzle-orm"

/**
 * PUB-02 owner-only hub listing writer.
 *
 * The league's cross-league discoverability is the OWNER's publication
 * decision, so identity is resolved from the Clerk session to the account
 * that owns the league (`tenants.owner_id`) — never from a client argument
 * and never from an ordinary membership (a settings:manage admin cannot
 * publish the league to the hub). The tenant row is locked before the write
 * so an ownership/activation change serializes against the listing decision,
 * and the decision is audited verbatim with before/after state.
 *
 * The audit row is tenant-scoped (the decision is about a specific league,
 * unlike the per-person career consent, which intentionally crosses none).
 */

export type HubListingResult = {
  listed: HubListingStatus
  listedAt: Date | null
  /** False when the decision matched the current state (no write performed). */
  changed: boolean
}

export async function setHubListing(enable: boolean): Promise<HubListingResult> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: hub listing account unavailable")

  return db.transaction(async (tx) => {
    // Serialise against ownership/activation changes on this league row.
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants}
      WHERE ${tenants.ownerId} = ${account.id} FOR UPDATE`)
    const [current] = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        isActive: tenants.isActive,
        hubListingStatus: tenants.hubListingStatus,
        hubListedAt: tenants.hubListedAt,
      })
      .from(tenants)
      .where(and(eq(tenants.ownerId, account.id), eq(tenants.isActive, true)))
      .limit(1)
    if (!current?.id) throw new Error("Forbidden: no active league is owned by this account")

    const decision = hubListingTransition(current.hubListingStatus, enable)
    if (!decision.changed) {
      return { listed: decision.status, listedAt: current.hubListedAt, changed: false }
    }

    const listedAt = enable ? new Date() : null
    const [updated] = await tx
      .update(tenants)
      .set({ hubListingStatus: decision.status, hubListedAt: listedAt, updatedAt: new Date() })
      .where(and(eq(tenants.id, current.id), eq(tenants.ownerId, account.id)))
      .returning({ hubListingStatus: tenants.hubListingStatus, hubListedAt: tenants.hubListedAt })
    if (updated?.hubListingStatus !== decision.status) {
      throw new Error("The hub listing decision could not be recorded. Please retry.")
    }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: current.id,
      actorId: account.id,
      actorRole: "owner",
      method: "HUB_LISTING",
      path: "/dashboard/settings",
      statusCode: "200",
      payload: {
        enable,
        before: { hubListingStatus: current.hubListingStatus, hubListedAt: current.hubListedAt },
        after: { hubListingStatus: updated.hubListingStatus, hubListedAt: updated.hubListedAt },
      },
    })

    return { listed: updated.hubListingStatus, listedAt: updated.hubListedAt, changed: true }
  }, { isolationLevel: "read committed" })
}

/**
 * Owner-visible current listing state. Non-owners (including settings:manage
 * staff who do not own the league) get `isOwner: false` and no state — the
 * settings UI must not even reveal the toggle, let alone allow a write.
 */
export type OwnerHubListing = { isOwner: boolean; listed: HubListingStatus; listedAt: Date | null; eligible: boolean }

export async function readMyHubListing(): Promise<OwnerHubListing> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: hub listing account unavailable")

  const [owned] = await db
    .select({
      isActive: tenants.isActive,
      hubListingStatus: tenants.hubListingStatus,
      hubListedAt: tenants.hubListedAt,
    })
    .from(tenants)
    .where(and(eq(tenants.ownerId, account.id), eq(tenants.isActive, true)))
    .limit(1)
  if (!owned) return { isOwner: false, listed: HUB_UNLISTED, listedAt: null, eligible: false }

  return {
    isOwner: true,
    listed: owned.hubListingStatus,
    listedAt: owned.hubListedAt,
    eligible: hubListingEligible(owned),
  }
}
