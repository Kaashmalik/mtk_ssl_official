import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema/users";

// ---------------------------------------------------------------------------
// Tenant Context — AsyncLocalStorage
// ---------------------------------------------------------------------------

/**
 * Per-request context that flows through the entire async call tree without
 * needing to pass `tenantId` / `userId` as explicit parameters to every
 * function.  Set once at the start of a server action or API route handler;
 * all downstream repository calls read from it automatically.
 *
 * Why not just pass parameters?
 *  - Eliminates the "forgotten where clause" bug class: the repo layer ALWAYS
 *    reads tenantId from context, never from user-supplied input.
 *  - Works seamlessly with Drizzle relational queries and sub-selects where
 *    an explicit param would be awkward.
 */
export interface TenantContext {
  /** Clerk user id of the acting user. */
  userId: string;
  /** The tenant (league/organization) this request operates within. */
  tenantId: string;
  /** Cached user role — avoids a round-trip per permission check. */
  role?: string;
}

const tenantContextStore = new AsyncLocalStorage<TenantContext | null>();

/**
 * Run `fn` with the given tenant context set for the duration of the call.
 * This is the single entry-point that server actions / API routes use.
 */
export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantContextStore.run(ctx, fn);
}

/**
 * Run `fn` WITHOUT tenant context (e.g., super-admin cross-tenant queries).
 * The repository layer's `requireTenant` will throw if used under a null ctx.
 */
export async function withoutTenantContext<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStore.run(null, fn);
}

/** Get the current tenant context, or null if not set. */
export function getTenantContext(): TenantContext | null {
  return tenantContextStore.getStore() ?? null;
}

/**
 * Assert that a tenant context exists and return it.
 * Throws if called outside a `withTenantContext` boundary — this prevents
 * unscoped queries from executing silently.
 */
export function requireTenantContext(): TenantContext {
  const ctx = tenantContextStore.getStore();
  if (!ctx) {
    throw new Error(
      "[tenant-context] No tenant context set. " +
        "Wrap this call with withTenantContext(). " +
        "This usually means a server action or API route did not resolve the tenant."
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helper: resolve the tenant from Clerk user id
// ---------------------------------------------------------------------------

/**
 * Look up the user's tenantIds array from the `users` table and return the
 * first one.  This is the default resolution for league owners who manage a
 * single league.  Multi-tenant users (e.g., a scorer in many leagues) must
 * explicitly pass the `tenantId` they intend to act on.
 */
export async function resolveDefaultTenantId(clerkUserId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkUserId),
    columns: { tenantIds: true },
  });

  if (!user || !user.tenantIds || user.tenantIds.length === 0) return null;
  return user.tenantIds[0];
}

/**
 * Verify that `clerkUserId` is allowed to act within `tenantId`.
 * Returns the user's role within that tenant (or null if unauthorized).
 */
export async function verifyTenantMembership(
  clerkUserId: string,
  tenantId: string
): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkUserId),
    columns: { tenantIds: true, role: true },
  });

  if (!user) return null;
  if (!user.tenantIds?.includes(tenantId)) return null;
  return user.role;
}
