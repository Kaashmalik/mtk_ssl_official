import { z } from "zod"

const count = z.number().int().nonnegative().safe()
export const liveInningsSchema = z.object({
  matchId: z.string().uuid(),
  innings: z.number().int().min(1).max(3),
  inningsId: z.string().uuid(),
  teamId: z.string().uuid(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  totalRuns: count,
  totalWickets: count,
  totalBalls: count,
  overs: count,
  balls: z.number().int().min(0).max(5),
  runRate: z.number().finite().nonnegative(),
  extras: count,
  wides: count,
  noBalls: count,
  byes: count,
  legByes: count,
  updatedAt: z.string().datetime(),
}).refine((value) => value.totalBalls === value.overs * 6 + value.balls && value.extras <= value.totalRuns,
  "Inconsistent innings accounting")

export const liveMatchStateSchema = z.object({
  version: z.literal(2),
  matchId: z.string().uuid(),
  status: z.enum(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "cancelled", "no_result"]),
  currentInnings: z.number().int().min(1).max(3),
  updatedAt: z.string().datetime(),
  innings1: liveInningsSchema.optional(),
  innings2: liveInningsSchema.optional(),
  superOver: liveInningsSchema.optional(),
}).refine((value) => [value.innings1, value.innings2, value.superOver].every((innings, index) =>
  !innings || (innings.matchId === value.matchId && innings.innings === index + 1)), "Mismatched innings identity")

export type LiveInnings = z.infer<typeof liveInningsSchema>
export type LiveMatchState = z.infer<typeof liveMatchStateSchema>

/** Cache and WebSocket traffic are untrusted; discard old/incomplete contracts. */
export function decodeLiveMatchState(input: unknown): LiveMatchState | null {
  const result = liveMatchStateSchema.safeParse(input)
  return result.success ? result.data : null
}
