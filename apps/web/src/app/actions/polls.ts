"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createTournamentPoll, setTournamentPollStatus, voteOnTournamentPoll } from "@/lib/tournament-polls"

/**
 * Thin delegates over the locked FAN-01 poll writers. Identity/league
 * resolution, option/question policy, lifecycle rules and the publication
 * gate all live in the writers - this tier only parses and revalidates.
 *
 * Scope safety is structural: the SESSION resolves the league, so a poll or
 * tournament id from another league reads honestly as not-found there.
 */

const tournamentIdInput = z.string().uuid()
const pollIdInput = z.string().uuid()

export async function createPoll(
  tournamentIdInputValue: unknown,
  questionInput: unknown,
  optionsInput: unknown,
) {
  const tournamentId = tournamentIdInput.parse(tournamentIdInputValue)
  const question = z.string().max(400).parse(questionInput)
  const options = z.array(z.unknown()).min(1).parse(optionsInput)
  const result = await createTournamentPoll({ tournamentId, question, options })
  revalidatePath(`/tournaments/${tournamentId}`)
  return { success: true as const, pollId: result.pollId, tournamentId }
}

export async function setPollStatus(pollIdInputValue: unknown, statusInput: unknown) {
  const pollId = pollIdInput.parse(pollIdInputValue)
  const status = z.string().min(1).max(16).parse(statusInput)
  const result = await setTournamentPollStatus({ pollId, status })
  if (result.ok) revalidatePath(`/tournaments/${result.tournamentId}`)
  return result
}

export async function voteOnPoll(pollIdInputValue: unknown, optionIndexInput: unknown) {
  const pollId = pollIdInput.parse(pollIdInputValue)
  const optionIndex = z.number().int().parse(optionIndexInput)
  // No revalidate: the reply carries fresh aggregate counts and the public
  // surface is noStore - the client state update IS the truth.
  return voteOnTournamentPoll({ pollId, optionIndex })
}
