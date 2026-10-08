import { ilike, eq, asc } from "drizzle-orm";
import { players } from "../schema/players";
import { TenantScopedRepository } from "./base";

/**
 * Tenant-scoped repository for players.
 */
export class PlayerRepo extends TenantScopedRepository {
  table = players;
  idColumn = players.id;
  tenantCol = players.tenantId;

  async findByTeam(teamId: string, opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(players.teamId, teamId),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: asc(players.name),
    });
  }

  async findActive(opts?: { limit?: number; offset?: number }) {
    return this.findMany({
      where: eq(players.isActive, true),
      limit: opts?.limit,
      offset: opts?.offset,
      orderBy: asc(players.name),
    });
  }

  async searchByName(query: string, opts?: { limit?: number }) {
    return this.findMany({
      where: ilike(players.name, `%${query}%`),
      limit: opts?.limit ?? 20,
      orderBy: asc(players.name),
    });
  }
}

export const playerRepo = new PlayerRepo();
