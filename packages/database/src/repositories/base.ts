import { eq, and, type SQL, type AnyColumn, count as countFn } from "drizzle-orm";
import { db } from "../client";
import { requireTenantContext } from "../tenant-context";

/**
 * The Drizzle methods (.from(), .insert(), .update(), .delete()) require a
 * strongly-typed PgTable. We type the `table` field loosely here and cast to
 * `never` only at the db boundary — the concrete subclass always assigns a
 * real, fully-typed Drizzle table, so runtime behaviour is correct. The cast
 * is localised so it never leaks to callers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzleTable = any;

/**
 * Locate the `tenantId` column on a table.
 * Throws at runtime (not type-check) if the table has no tenantId — this
 * surfaces misconfiguration early instead of silently producing unscoped queries.
 */
function getTenantIdColumn(table: AnyDrizzleTable): AnyColumn {
  const col = table["tenantId"];
  if (!col || typeof col !== "object" || !("columnType" in col)) {
    throw new Error(
      "[repo] Table has no tenantId column. Cannot create a tenant-scoped repository for it."
    );
  }
  return col as AnyColumn;
}

/**
 * Base class for tenant-scoped CRUD operations.
 *
 * SECURITY INVARIANT: every public method in this class automatically injects
 * `AND tenantId = <current-tenant-context>` into the WHERE clause. There is no
 * method that returns unscoped data. The only escape hatch is `unscoped()`
 * which logs a warning in production.
 *
 * Subclasses must set `table`, `idColumn`, and `tenantCol`.
 *
 * Example:
 *   class TournamentRepo extends TenantScopedRepository {
 *     table = tournaments;
 *     idColumn = tournaments.id;
 *     tenantCol = tournaments.tenantId;
 *   }
 */
export abstract class TenantScopedRepository {
  /** The Drizzle table definition (loosely typed; subclass assigns a real table). */
  abstract table: AnyDrizzleTable;
  /** The primary-key column. */
  abstract idColumn: AnyColumn;
  /** The tenantId column (usually `<table>.tenantId`). */
  abstract tenantCol: AnyColumn;

  /** Inject `tenantId = <current>` into conditions. */
  protected tenantScope(): SQL {
    const ctx = requireTenantContext();
    return eq(this.tenantCol, ctx.tenantId);
  }

  /** Combine optional user conditions with the mandatory tenant scope. */
  protected scopedWhere(conditions?: SQL | undefined): SQL | undefined {
    if (conditions) return and(this.tenantScope(), conditions);
    return this.tenantScope();
  }

  // ---- Read operations (all scoped) ----

  /** Find one row by id within the current tenant. */
  async findById<T = unknown>(id: string): Promise<T | null> {
    const results = await db
      .select()
      .from(this.table)
      .where(and(this.tenantScope(), eq(this.idColumn, id)))
      .limit(1);
    return (results[0] as T) ?? null;
  }

  /** Find many rows, optionally filtered, ordered, paginated. */
  async findMany<T = unknown>(opts?: {
    where?: SQL;
    limit?: number;
    offset?: number;
    orderBy?: SQL;
  }): Promise<T[]> {
    // `query` is typed loosely because Drizzle's select-builder chain types
    // change per call; the final cast to T[] preserves caller type-safety.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db
      .select()
      .from(this.table)
      .where(this.scopedWhere(opts?.where) ?? undefined);

    if (opts?.limit !== undefined) query = query.limit(opts.limit);
    if (opts?.offset !== undefined) query = query.offset(opts.offset);
    if (opts?.orderBy) query = query.orderBy(opts.orderBy);

    return query as unknown as Promise<T[]>;
  }

  /** Count rows within the current tenant, optionally filtered. */
  async count(opts?: { where?: SQL }): Promise<number> {
    const [row] = await db
      .select({ value: countFn() })
      .from(this.table)
      .where(this.scopedWhere(opts?.where));
    return Number(row?.value ?? 0);
  }

  // ---- Write operations (all scoped) ----

  /** Insert a row. The `tenantId` field is force-set from context. */
  async insert<T = unknown>(values: Record<string, unknown>): Promise<T[]> {
    return db
      .insert(this.table)
      .values({
        ...values,
        tenantId: requireTenantContext().tenantId,
      })
      .returning() as unknown as Promise<T[]>;
  }

  /** Insert exactly one row and return it (or null on conflict). */
  async insertOne<T = unknown>(values: Record<string, unknown>): Promise<T | null> {
    const rows = await this.insert<T>(values);
    return rows[0] ?? null;
  }

  /**
   * Update rows matching `id` within the current tenant.
   * Returns the updated row (or null if not found / wrong tenant).
   */
  async updateById<T = unknown>(id: string, values: Record<string, unknown>): Promise<T | null> {
    const rows = (await db
      .update(this.table)
      .set(values)
      .where(and(this.tenantScope(), eq(this.idColumn, id)))
      .returning()) as unknown as T[];
    return rows[0] ?? null;
  }

  /**
   * Delete a row by id within the current tenant.
   * Returns true if a row was actually deleted.
   */
  async deleteById(id: string): Promise<boolean> {
    const result = (await db
      .delete(this.table)
      .where(and(this.tenantScope(), eq(this.idColumn, id)))) as unknown as { rowCount?: number };

    // postgres-js returns rowCount on the result; drizzle forwards it.
    return (result.rowCount ?? 0) > 0;
  }

  // ---- Escape hatch (use sparingly) ----

  /**
   * Access the raw db query builder without tenant scoping.
   * This exists for legitimate cross-tenant queries (e.g., super-admin lookups)
   * and should NEVER be called from within a server action that handles
   * tenant-scoped user data.
   */
  unscoped() {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[repo] Unscoped query requested. Ensure this is intentional and not a tenant-isolation bypass."
      );
    }
    return db;
  }
}

/** Re-exported for subclass convenience. */
export { getTenantIdColumn };
