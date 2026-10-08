import { eq, desc, asc, or } from "drizzle-orm";
import { matches } from "../schema/matches";
import { TenantScopedRepository } from "./base";

/**
 * Tenant-scoped repository for matches.
 */
export class MatchRepo extends TenantScopedRepository {
  table = matches;
  idColumn = matches.id;
  tenantCol = matches.tenantId;

  async findByTournament(tournamentId: string, opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(matches.tournamentId, tournamentId),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: asc(matches.scheduledDate),
    });
  }

  async findLive() {
    return this.findMany({
      where: eq(matches.status, "live"),
      orderBy: asc(matches.scheduledDate),
    });
  }

  async findByTeam(teamId: string, opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(matches.teamAId, teamId),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: desc(matches.scheduledDate),
    });
  }

  /**
   * Find matches involving a specific team (as team A or team B).
   * This requires a custom unscoped approach since Drizzle OR across
   * the same column with different values needs `or()`.
   */
  async findForTeam(teamId: string, opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: desc(matches.scheduledDate),
    });
  }
}

export const matchRepo = new MatchRepo();
