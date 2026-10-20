/**
 * Lifecycle publication policy, shared by web and live-read services.
 *
 * ENH-03-01: the published-status VALUES and gates are single-sourced from
 * `@mtk/contracts` (the portable vocabulary every surface now reads), so the
 * SQL gate, the web readers and the native app cannot drift apart. This
 * module remains the database-layer import point - existing imports keep
 * working unchanged.
 */
export {
  PUBLISHED_MATCH_STATUS_VALUES,
  PUBLISHED_TOURNAMENT_STATUS_VALUES,
  isMatchPublished,
  isTournamentPublished,
} from "@mtk/contracts"
