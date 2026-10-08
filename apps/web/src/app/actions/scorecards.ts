"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db } from "@mtk/database"
import { battingScorecards, bowlingScorecards, fieldingScorecards, matches } from "@mtk/database"
import { eq, asc, and } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"


// ─── Schemas ──────────────────────────────────────────────────

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

const saveScorecardSchema = z.object({
  tenantId: z.string().uuid().optional(),
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  batting: z.array(battingEntrySchema),
  bowling: z.array(bowlingEntrySchema),
})

export type SaveScorecardInput = z.infer<typeof saveScorecardSchema>

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

// ─── Actions ──────────────────────────────────────────────────

export const saveScorecard = withAuth("scorecard:create", async (input: SaveScorecardInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const validated = saveScorecardSchema.parse({
    ...input,
    tenantId: input.tenantId ?? tenant.id,
  })
  if (validated.tenantId !== tenant.id) throw new Error("Invalid tenant")
  const { tenantId, matchId, inningsId, batting, bowling } = validated

  const [match] = await db.select().from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenant.id)))
    .limit(1)
  if (!match) throw new Error("Match not found")

  // Insert batting entries with calculated strike rate
  if (batting.length > 0) {
    const battingValues = batting.map((b) => ({
      tenantId, matchId, inningsId,
      playerId: b.playerId, teamId: b.teamId,
      battingPosition: b.battingPosition,
      runs: b.runs, ballsFaced: b.ballsFaced,
      fours: b.fours, sixes: b.sixes,
      strikeRate: b.ballsFaced > 0 ? ((b.runs / b.ballsFaced) * 100).toFixed(2) : "0",
      dismissalType: b.dismissalType,
      bowlerId: b.bowlerId ?? null, fielderId: b.fielderId ?? null,
      dismissalText: b.dismissalText ?? null,
      dotBalls: b.dotBalls,
    }))
    await db.insert(battingScorecards).values(battingValues)
  }

  // Insert bowling entries with calculated economy & overs
  if (bowling.length > 0) {
    const bowlingValues = bowling.map((b) => {
      const overs = Math.floor(b.ballsBowled / 6) + (b.ballsBowled % 6) / 10
      const economy = b.ballsBowled > 0 ? ((b.runsConceded / b.ballsBowled) * 6).toFixed(2) : "0"
      return {
        tenantId, matchId, inningsId,
        playerId: b.playerId, teamId: b.teamId,
        bowlingPosition: b.bowlingPosition,
        overs: overs.toFixed(1), ballsBowled: b.ballsBowled,
        maidens: b.maidens, runsConceded: b.runsConceded,
        wickets: b.wickets, economyRate: economy,
        wides: b.wides, noBalls: b.noBalls,
        dotBalls: b.dotBalls, fours: 0, sixes: 0,
      }
    })
    await db.insert(bowlingScorecards).values(bowlingValues)
  }

  revalidatePath(`/dashboard/matches/${matchId}`)
  return { success: true }
})

export const getFullScorecard = withAuth("scorecard:read", async (matchId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [batting, bowling, fielding] = await Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenant.id)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenant.id)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
    db.select().from(fieldingScorecards)
      .where(and(eq(fieldingScorecards.matchId, matchId), eq(fieldingScorecards.tenantId, tenant.id))),
  ])
  return { batting, bowling, fielding }
})

export const getInningsScorecard = withAuth("scorecard:read", async (inningsId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const [batting, bowling] = await Promise.all([
    db.select().from(battingScorecards)
      .where(and(eq(battingScorecards.inningsId, inningsId), eq(battingScorecards.tenantId, tenant.id)))
      .orderBy(asc(battingScorecards.battingPosition)),
    db.select().from(bowlingScorecards)
      .where(and(eq(bowlingScorecards.inningsId, inningsId), eq(bowlingScorecards.tenantId, tenant.id)))
      .orderBy(asc(bowlingScorecards.bowlingPosition)),
  ])
  return { batting, bowling }
})
