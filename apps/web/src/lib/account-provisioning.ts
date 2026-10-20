/**
 * ENH-02-01 (delayed-webhook recovery): create the local users row for a
 * signed-in account whose Clerk webhook has not landed (or died) yet.
 *
 * The data source is the SERVER-VERIFIED session (`currentUser()` from
 * Clerk) — never client-supplied claims. Semantics mirror the webhook's
 * `user.created` exactly: fan role, active, insert-only. A row that already
 * exists (the webhook won the race) is left COMPLETELY untouched — this
 * module has no UPDATE path, so an existing account's state (role, active
 * flag) can never be altered by a dashboard read.
 */

import { currentUser } from "@clerk/nextjs/server"
import { db, users } from "@mtk/database"

export async function reconcileSessionUser(): Promise<boolean> {
  try {
    const session = await currentUser()
    if (!session?.id) return false
    const email = session.emailAddresses?.[0]?.emailAddress ?? session.primaryEmailAddress?.emailAddress ?? null
    // The webhook refuses rows without an email; so does the reconciler.
    if (!email) return false
    const displayName =
      [session.firstName, session.lastName].filter(Boolean).join(" ").trim() || session.username || null

    await db
      .insert(users)
      .values({
        clerkId: session.id,
        email,
        displayName,
        avatarUrl: session.imageUrl ?? null,
        role: "fan",
        isActive: true,
        lastLoginAt: null,
      })
      .onConflictDoNothing({ target: users.clerkId })
    return true
  } catch {
    // Recovery is best-effort: the dashboard must still render its truthful
    // provisioning notice when this cannot run.
    return false
  }
}
