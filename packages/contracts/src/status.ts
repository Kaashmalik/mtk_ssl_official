/**
 * ENH-03-01: the complete lifecycle vocabulary, portable to every surface.
 *
 * These values are the WIRE CONTRACT shared by the web app, the native app,
 * the scoring service adapters and the database layer. The authoritative
 * pg enums live in `packages/database/src/schema/*`; publication gating
 * lives in `packages/database/src/lib/publication-policy.ts` (which imports
 * the published-value mirrors from here, so the lists cannot drift). The
 * native app's hand-rolled unions previously diverged (it missed
 * `forfeited` and `postponed`); this module is now the one place both read.
 *
 * Everything here is pure TypeScript: no Next, no DOM, no node, no database,
 * no server secrets - safe for Expo/React Native by construction.
 */

export const MATCH_STATUS_VALUES = [
  "scheduled",
  "toss",
  "live",
  "innings_break",
  "completed",
  "abandoned",
  "cancelled",
  "no_result",
  "forfeited",
  "postponed",
] as const
export type MatchStatus = (typeof MATCH_STATUS_VALUES)[number]

export const TOURNAMENT_STATUS_VALUES = [
  "draft",
  "registration",
  "live",
  "completed",
  "cancelled",
] as const
export type TournamentStatus = (typeof TOURNAMENT_STATUS_VALUES)[number]

/**
 * Publication mirrors (PUB-01/PUB-03). Single-sourced: the database layer's
 * `publication-policy.ts` re-exports these exact arrays, so a published
 * surface on any consumer uses the same values as the SQL gate.
 */
export const PUBLISHED_TOURNAMENT_STATUS_VALUES = [
  "registration",
  "live",
  "completed",
] as const
export const PUBLISHED_MATCH_STATUS_VALUES = [
  "scheduled",
  "toss",
  "live",
  "innings_break",
  "completed",
  "abandoned",
  "no_result",
] as const

const publishedTournaments: ReadonlySet<string> = new Set(
  PUBLISHED_TOURNAMENT_STATUS_VALUES,
)
const publishedMatches: ReadonlySet<string> = new Set(
  PUBLISHED_MATCH_STATUS_VALUES,
)

export function isTournamentPublished(status: string | null | undefined): boolean {
  return !!status && publishedTournaments.has(status)
}

export function isMatchPublished(status: string | null | undefined): boolean {
  return !!status && publishedMatches.has(status)
}

export const MATCH_FORMAT_VALUES = ["t20", "odi", "test", "t10", "custom"] as const
export type MatchFormat = (typeof MATCH_FORMAT_VALUES)[number]

export const MATCH_TYPE_VALUES = [
  "group",
  "knockout",
  "final",
  "semi_final",
  "quarter_final",
  "friendly",
  "practice",
] as const
export type MatchType = (typeof MATCH_TYPE_VALUES)[number]

export const TOSS_DECISION_VALUES = ["bat", "bowl"] as const
export type TossDecision = (typeof TOSS_DECISION_VALUES)[number]

export const WICKET_TYPE_VALUES = [
  "bowled",
  "caught",
  "lbw",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "retired_hurt",
] as const
export type WicketType = (typeof WICKET_TYPE_VALUES)[number]

export const STREAM_SOURCE_VALUES = [
  "facebook",
  "youtube",
  "rtmp",
  "webrtc",
] as const
export type StreamSource = (typeof STREAM_SOURCE_VALUES)[number]

export const STREAM_STATUS_VALUES = ["idle", "live", "ended"] as const
export type StreamStatus = (typeof STREAM_STATUS_VALUES)[number]

export const INNINGS_STATUS_VALUES = [
  "not_started",
  "in_progress",
  "completed",
] as const
export type InningsStatus = (typeof INNINGS_STATUS_VALUES)[number]

export const PLAYER_ROLE_VALUES = [
  "batsman",
  "bowler",
  "all_rounder",
  "wicket_keeper",
  "wicket_keeper_batsman",
] as const
export type PlayerRole = (typeof PLAYER_ROLE_VALUES)[number]

export const BATTING_STYLE_VALUES = ["right", "left"] as const
export type BattingStyle = (typeof BATTING_STYLE_VALUES)[number]

export const BOWLING_STYLE_VALUES = [
  "right_arm_fast",
  "right_arm_medium",
  "right_arm_spin",
  "left_arm_fast",
  "left_arm_medium",
  "left_arm_spin",
] as const
export type BowlingStyle = (typeof BOWLING_STYLE_VALUES)[number]

export const ANNOUNCEMENT_TYPE_VALUES = [
  "info",
  "warning",
  "success",
  "error",
  "maintenance",
] as const
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPE_VALUES)[number]

export const ANNOUNCEMENT_PRIORITY_VALUES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITY_VALUES)[number]
