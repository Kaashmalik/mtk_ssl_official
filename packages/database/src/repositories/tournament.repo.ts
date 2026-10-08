import { ilike, eq, desc, asc, and, type SQL } from "drizzle-orm";
import { tournaments } from "../schema/tournaments";
import { TenantScopedRepository } from "./base";

/**
 * Tenant-scoped repository for tournaments.
 *
 * Every query automatically filters by the current tenant context — there is
 * no way to accidentally read or modify another tenant's tournaments through
 * this class.
 */
export class TournamentRepo extends TenantScopedRepository {
  table = tournaments;
  idColumn = tournaments.id;
  tenantCol = tournaments.tenantId;

  /**
   * Find tournaments with optional status/search filter, sorted and paginated.
   */
  async findFiltered(opts: {
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
    sortBy?: "name" | "createdAt" | "startDate";
    sortOrder?: "asc" | "desc";
  }) {
    const {
      status,
      search,
      page,
      pageSize,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = opts;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(tournaments.status, status as "draft" | "registration" | "live" | "completed" | "cancelled"));

    // Note: we only add search if it's non-empty to avoid accidental wildcard matches.
    if (search && search.trim().length > 0) {
      conditions.push(ilike(tournaments.name, `%${search}%`));
    }

    const whereClause = conditions.length > 0
      ? conditions.reduce((acc, cond) => and(acc, cond) as SQL)
      : undefined;

    const orderFn = sortOrder === "desc" ? desc : asc;
    const orderColumn =
      sortBy === "name"
        ? tournaments.name
        : sortBy === "startDate"
          ? tournaments.startDate
          : tournaments.createdAt;

    const [data, countResult] = await Promise.all([
      this.findMany({
        where: whereClause,
        limit: pageSize,
        offset,
        orderBy: orderFn(orderColumn),
      }),
      this.count({ where: whereClause }),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total: countResult,
        totalPages: Math.ceil(countResult / pageSize),
      },
    };
  }
}

/** Singleton — safe to reuse across requests since state comes from AsyncLocalStorage. */
export const tournamentRepo = new TournamentRepo();
