"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { forfeitMatch, postponeMatch, rescheduleMatch } from "@/lib/competition-control"

/**
 * COMP-07 (Batch 153): thin action wrappers over the competition-control
 * writer. The writer holds every authority and state-machine rule; these
 * bounds exist so malformed input never reaches a transaction.
 */

const idSchema = z.string().uuid()
const reasonSchema = z.string().min(1).max(500)

export async function forfeitMatchAction(input: { matchId: string; reason: string }) {
  const parsed = z.object({ matchId: idSchema, reason: reasonSchema }).strict().parse(input)
  const result = await forfeitMatch(parsed.matchId, parsed.reason)
  revalidatePath("/dashboard/matches")
  return result
}

export async function postponeMatchAction(input: { matchId: string; reason: string }) {
  const parsed = z.object({ matchId: idSchema, reason: reasonSchema }).strict().parse(input)
  const result = await postponeMatch(parsed.matchId, parsed.reason)
  revalidatePath("/dashboard/matches")
  return result
}

export async function rescheduleMatchAction(input: { matchId: string; newDate: string }) {
  const parsed = z.object({ matchId: idSchema, newDate: z.string().min(4).max(40) }).strict().parse(input)
  const result = await rescheduleMatch(parsed.matchId, parsed.newDate)
  revalidatePath("/dashboard/matches")
  return result
}
