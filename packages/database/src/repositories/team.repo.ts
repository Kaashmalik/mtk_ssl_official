import { ilike, desc, asc, eq } from "drizzle-orm";
import { teams } from "../schema/teams";
import { TenantScopedRepository } from "./base";

/**
 * Tenant-scoped repository for teams.
 */
export class TeamRepo extends TenantScopedRepository {
  table = teams;
  idColumn = teams.id;
  tenantCol = teams.tenantId;

  async findByTournament(tournamentId: string, opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(teams.tournamentId, tournamentId),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: desc(teams.createdAt),
    });
  }

  async findActive(opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(teams.isActive, true),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: asc(teams.name),
    });
  }

  async searchByName(query: string, opts?: { limit?: number }) {
    return this.findMany({
      where: ilike(teams.name, `%${query}%`),
      limit: opts?.limit ?? 20,
      orderBy: asc(teams.name),
    });
  }
}

export const teamRepo = new TeamRepo();
