import { auth } from "@clerk/nextjs/server"
import { accountLocalePreferences, auditLogs, db, users } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { isLocale, type Locale } from "@/i18n/config"

const ready = () => process.env.ACCOUNT_LOCALE_PREFERENCES_READY === "true"

export async function readMyLocalePreference(): Promise<Locale | null> {
  if (!ready()) return null
  const { userId } = await auth()
  if (!userId) return null
  const [row] = await db.select({ locale: accountLocalePreferences.locale }).from(accountLocalePreferences)
    .innerJoin(users, and(eq(users.id, accountLocalePreferences.userId), eq(users.clerkId, userId), eq(users.isActive, true)))
    .limit(1)
  return row && isLocale(row.locale) ? row.locale : null
}

/** Cookie remains available for guests; only an active session can write account preferences. */
export async function saveMyLocalePreference(locale: Locale): Promise<boolean> {
  if (!isLocale(locale)) throw new Error("Unsupported language")
  if (!ready()) return false
  const { userId } = await auth()
  if (!userId) return false
  await db.transaction(async tx => {
    const [actor] = await tx.select({ id: users.id, active: users.isActive }).from(users)
      .where(eq(users.clerkId, userId)).for("update").limit(1)
    if (!actor || actor.active !== true) throw new Error("Account unavailable")
    const [previous] = await tx.select({ locale: accountLocalePreferences.locale }).from(accountLocalePreferences)
      .where(eq(accountLocalePreferences.userId, actor.id)).limit(1)
    if (previous?.locale === locale) return
    await tx.insert(accountLocalePreferences).values({ userId: actor.id, locale })
      .onConflictDoUpdate({ target: accountLocalePreferences.userId, set: { locale, updatedAt: sql`now()` } })
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId: null, actorId: actor.id, actorRole: null,
      method: "ACCOUNT_LOCALE", path: "/dashboard/account", statusCode: "200", payload: { before: previous?.locale ?? null, after: locale } })
  })
  return true
}
