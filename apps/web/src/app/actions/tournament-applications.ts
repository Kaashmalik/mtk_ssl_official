"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  decideTournamentApplication,
  replyToTournamentApplication,
  readApplicationReplies,
  submitTournamentApplication,
  withdrawTournamentApplication,
} from "@/lib/tournament-applications"

/**
 * REG-03 (Batch 147/164): thin action wrappers over the tournament-
 * application writer. The writer holds every authority and state-machine
 * rule; these bounds exist so malformed input never reaches a transaction.
 */

const idSchema = z.string().uuid()
const decisionSchema = z.enum(["approve", "request_information", "waitlist", "decline"])
const replySchema = z.object({ applicationId: idSchema, body: z.string().min(1).max(2100) })

export async function submitTournamentApplicationAction(input: { tournamentId: string; teamId: string }) {
  const parsed = z.object({ tournamentId: idSchema, teamId: idSchema }).strict().parse(input)
  const result = await submitTournamentApplication(parsed.tournamentId, parsed.teamId)
  revalidatePath("/dashboard/tournaments")
  revalidatePath(`/dashboard/tournaments/${parsed.tournamentId}`)
  return result
}

export async function withdrawTournamentApplicationAction(input: { applicationId: string }) {
  const parsed = z.object({ applicationId: idSchema }).strict().parse(input)
  const result = await withdrawTournamentApplication(parsed.applicationId)
  revalidatePath("/dashboard/tournaments")
  return result
}

export async function decideTournamentApplicationAction(input: { applicationId: string; decision: string }) {
  const parsed = z.object({ applicationId: idSchema, decision: decisionSchema }).strict().parse(input)
  const result = await decideTournamentApplication(parsed.applicationId, parsed.decision)
  revalidatePath("/dashboard/tournaments")
  return result
}

export async function replyToTournamentApplicationAction(input: { applicationId: string; body: string }) {
  const parsed = replySchema.strict().parse(input)
  const result = await replyToTournamentApplication(parsed.applicationId, parsed.body)
  revalidatePath("/dashboard/tournaments")
  return result
}

export async function readApplicationRepliesAction(input: { applicationId: string }) {
  const parsed = z.object({ applicationId: idSchema }).strict().parse(input)
  return readApplicationReplies(parsed.applicationId)
}
