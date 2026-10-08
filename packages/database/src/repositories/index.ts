export { TenantScopedRepository, getTenantIdColumn } from "./base";

// Export both the class (for subclassing/testing) and the ready-to-use
// singleton instance (for direct import in server actions / API routes).
export { TournamentRepo, tournamentRepo } from "./tournament.repo";
export { TeamRepo, teamRepo } from "./team.repo";
export { PlayerRepo, playerRepo } from "./player.repo";
export { MatchRepo, matchRepo } from "./match.repo";
