import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { teams } from "./teams";
import { venues } from "./venues";
import { players } from "./players";
import { users } from "./users";

/**
 * Match format enum
 */
export const matchFormatEnum = pgEnum("match_format", ["t20", "odi", "test", "t10", "custom"]);

/**
 * Match type enum
 */
export const matchTypeEnum = pgEnum("match_type", [
  "group",
  "knockout",
  "final",
  "semi_final",
  "quarter_final",
  "friendly",
  "practice",
]);

/**
 * Match status enum
 */
export const matchStatusEnum = pgEnum("match_status", [
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
]);

/**
 * Toss decision enum
 */
export const tossDecisionEnum = pgEnum("toss_decision", ["bat", "bowl"]);

/**
 * Live stream source enum
 */
export const streamSourceEnum = pgEnum("stream_source", ["facebook", "youtube", "rtmp", "webrtc"]);

/**
 * Live stream status enum
 */
export const streamStatusEnum = pgEnum("stream_status", ["idle", "live", "ended"]);

/**
 * Matches table — Complete match data with format, overs, officials
 */
export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),

  // Teams
  teamAId: uuid("team_a_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  teamBId: uuid("team_b_id").notNull().references(() => teams.id, { onDelete: "cascade" }),

  // Venue & Schedule
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  matchNumber: integer("match_number"),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),

  // Match Config
  matchFormat: matchFormatEnum("match_format").notNull().default("t20"),
  matchType: matchTypeEnum("match_type").notNull().default("group"),
  groupLabel: text("group_label"),
  totalOvers: integer("total_overs").default(20),
  status: matchStatusEnum("status").notNull().default("scheduled"),
  forfeitReason: text("forfeit_reason"),
  postponementReason: text("postponement_reason"),

  // Toss
  tossWinnerId: uuid("toss_winner_id").references(() => teams.id),
  tossDecision: tossDecisionEnum("toss_decision"),

  // Result
  winnerId: uuid("winner_id").references(() => teams.id),
  result: text("result"), // e.g., "Team A won by 5 wickets"
  manOfMatchId: uuid("man_of_match_id").references(() => players.id, { onDelete: "set null" }),

  // Officials
  umpire1: text("umpire_1"),
  umpire2: text("umpire_2"),
  thirdUmpire: text("third_umpire"),
  /**
   * Member-bound officials (COMP-06): internal umpires as membership rows.
   * The person must be an effective member at assignment time (enforced
   * parent-side locks + writer rules); one member may never hold both slots.
   * The free-text columns above remain for external officials.
   */
  umpire1Id: uuid("umpire1_id").references(() => users.id, { onDelete: "set null" }),
  umpire2Id: uuid("umpire2_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Umpire consent (COMP-06, mirrors scorer approval): true once a current
   * assignment write has occupied a member umpire slot; free-text-only and
   * legacy rows stay false and keep legacy readiness.
   */
  umpireApprovalRequired: boolean("umpire_approval_required").notNull().default(false),
  /** When the assigned umpire approved; only the assigned member may set it, any assignment change clears it. */
  umpireApprovedAt: timestamp("umpire_approved_at", { withTimezone: true }),
  matchReferee: text("match_referee"),

  // Live streaming
  liveStreamUrl: text("live_stream_url"),
  streamSource: streamSourceEnum("stream_source"),
  streamStatus: streamStatusEnum("stream_status").notNull().default("idle"),

  // Scorer assignment
  scorerId: uuid("scorer_id").references(() => users.id, { onDelete: "set null" }),
  /** Backup scorer; may score when the primary is unavailable. Never the same user as scorerId. */
  backupScorerId: uuid("backup_scorer_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Official approval (COMP-06/IAM-06): true once a current assignment write
   * has occupied a slot; legacy matches stay false and keep legacy readiness.
   */
  scorerApprovalRequired: boolean("scorer_approval_required").notNull().default(false),
  /** When the assigned scorer approved; only the assigned member may set it, any assignment change clears it. */
  scorerApprovedAt: timestamp("scorer_approved_at", { withTimezone: true }),
  /**
   * Writer fencing token (SCORE-11): bumped (+1) by the locked, audited
   * scorer-assignment writer on every real primary/backup slot change.
   * Canonical scoring writes must echo the epoch they last observed; a
   * command without a token is accepted only while the epoch is still 0, so
   * after the first handover a stale device (including a re-occupied
   * scorer's old session) fails closed instead of silently writing. Legacy
   * rows default to 0 and keep pre-fencing behavior.
   */
  scorerHandoverEpoch: integer("scorer_handover_epoch").notNull().default(0),
  /** Durable optimistic concurrency; only canonical scoring mutations bump it. */
  scoringRevision: integer("scoring_revision").notNull().default(0),
  /**
   * Playing-XI gate (COMP-06 slice): armed by XI declaration writes; legacy
   * matches stay false and keep registered-squad-only eligibility. While
   * armed, deliveries are blocked until an official (league owner or assigned
   * member umpire) sets xiApprovedAt; every re-declaration clears it.
   */
  xiRequired: boolean("xi_required").notNull().default(false),
  /** Official approval of both declared playing XIs; cleared by every re-declaration. */
  xiApprovedAt: timestamp("xi_approved_at", { withTimezone: true }),

  // Metadata
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("matches_id_tenant_key").on(table.id, table.tenantId)]);

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
