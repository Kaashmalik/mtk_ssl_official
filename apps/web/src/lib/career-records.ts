import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { db, users, auditLogs } from "@mtk/database"
import { careerConsentGranted } from "@mtk/database/lib/career-records"
import { eq, sql } from "drizzle-orm"

/**
 * Self-service consent writer for PUB-03's cross-league career linkage.
 *
 * The person is resolved from the Clerk session — never a client argument —
 * and the consent row is locked before the write so a concurrent account
 * change (deactivation, relink) serializes against it. Consent is recorded
 * verbatim (grant => timestamp, revoke => null); per-league publication is
 * untouched by it, and the user-level audit row intentionally crosses no
 * league (tenant_id stays null).
 */
export async function setPublicCareerConsent(consent: boolean): Promise<{ granted: boolean; consentedAt: Date | null }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: consent account unavailable")

  return db.transaction(async (tx) => {
    // Member-like writers lock the account row: an actor-context change
    // (deactivation) serializes against this consent write.
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${account.id} FOR UPDATE`)
    const [current] = await tx
      .select({ publicCareerConsentAt: users.publicCareerConsentAt })
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1)
    if (current === undefined) throw new Error("Forbidden: consent account unavailable")
    const consentedAt = consent ? new Date() : null
    const [updated] = await tx
      .update(users)
      .set({ publicCareerConsentAt: consentedAt, updatedAt: new Date() })
      .where(eq(users.id, account.id))
      .returning({ publicCareerConsentAt: users.publicCareerConsentAt })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: account.id,
      actorRole: null,
      method: "PUBLIC_CAREER_CONSENT",
      path: "/dashboard/profile",
      statusCode: "200",
      payload: {
        consent,
        before: { publicCareerConsentAt: current.publicCareerConsentAt },
        after: { publicCareerConsentAt: updated.publicCareerConsentAt },
      },
    })
    return { granted: careerConsentGranted(updated), consentedAt: updated.publicCareerConsentAt }
  }, { isolationLevel: "read committed" })
}

/** Current consent state for the signed-in account (all-or-nothing, user-level). */
export async function readMyCareerConsent(): Promise<{ granted: boolean; consentedAt: Date | null }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const [row] = await db
    .select({ publicCareerConsentAt: users.publicCareerConsentAt, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!row || row.isActive !== true) throw new Error("Forbidden: consent account unavailable")
  return { granted: careerConsentGranted(row), consentedAt: row.publicCareerConsentAt }
}
