"use server"

import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import {
  findScopedInnings, readInningsScorecards, readMatchScorecards, requireScorecardMatch,
} from "@/lib/scorecard-reads"


// Legacy input shape retained for source compatibility only. There is no
// supported manual-import/correction command; the old writer is disabled below.

const battingEntrySchema = z.object({
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  battingPosition: z.number().int().min(1).max(11),
  runs: z.number().int().min(0).default(0),
  ballsFaced: z.number().int().min(0).default(0),
  fours: z.number().int().min(0).default(0),
  sixes: z.number().int().min(0).default(0),
  dismissalType: z.enum([
    "bowled", "caught", "caught_behind", "caught_and_bowled", "lbw",
    "run_out", "stumped", "hit_wicket", "retired", "retired_hurt",
    "obstructing_field", "timed_out", "handled_ball", "not_out",
  ]).default("not_out"),
  bowlerId: z.string().uuid().optional().nullable(),
  fielderId: z.string().uuid().optional().nullable(),
  dismissalText: z.string().optional().nullable(),
  dotBalls: z.number().int().min(0).default(0),
})

const bowlingEntrySchema = z.object({
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  bowlingPosition: z.number().int().min(1),
  ballsBowled: z.number().int().min(0).default(0),
  maidens: z.number().int().min(0).default(0),
  runsConceded: z.number().int().min(0).default(0),
  wickets: z.number().int().min(0).default(0),
  wides: z.number().int().min(0).default(0),
  noBalls: z.number().int().min(0).default(0),
  dotBalls: z.number().int().min(0).default(0),
})

// File-LOCAL schema (a "use server" file may only export async functions,
// so this can never be exported). Value-referenced inside the denial stub
// below so the input contract is still validated before the write refusal.
const saveScorecardSchema = z.object({
  tenantId: z.string().uuid().optional(),
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  batting: z.array(battingEntrySchema),
  bowling: z.array(bowlingEntrySchema),
})

export type SaveScorecardInput = z.infer<typeof saveScorecardSchema>

async function requireScorecardTenant(permission: "scorecard:read" | "scorecard:create") {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

// ─── Actions ──────────────────────────────────────────────────

/** @deprecated Record deliveries through scoring-service. A historical import
 * needs an explicit audited/idempotent canonical workflow, not direct inserts.
 * Keep this exported denial stub so old clients cannot revive a second writer.
 */
export const saveScorecard = withAuth("scorecard:create", async (input: SaveScorecardInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  // Value-use of the schema: even a refused write validates its input shape,
  // so malformed payloads fail with a validation error, not a blanket refusal.
  saveScorecardSchema.parse(input)
  await requireScorecardTenant("scorecard:create")
  throw new Error("Manual scorecard writes are disabled. Record deliveries through the scoring service; historical corrections require a canonical audited workflow.")
})

export const getFullScorecard = withAuth("scorecard:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(matchId)
  const tenantId = await requireScorecardTenant("scorecard:read")
  await requireScorecardMatch(matchId, tenantId)
  return readMatchScorecards(matchId, tenantId)
})

export const getInningsScorecard = withAuth("scorecard:read", async (inningsId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(inningsId)
  const tenantId = await requireScorecardTenant("scorecard:read")
  const innings = await findScopedInnings(inningsId, tenantId)
  await requireScorecardMatch(innings.matchId, tenantId)
  return readInningsScorecards(inningsId, innings.matchId, tenantId)
})
