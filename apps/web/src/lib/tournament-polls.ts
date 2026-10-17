import { randomUUID } from "crypto"
import {
  db, tournamentPolls, tournamentPollVotes, tournaments, auditLogs,
} from "@mtk/database"
import {
  normalizePollOptions, normalizePollQuestion, pollVoteDecision, pollTransitionDecision,
} from "@mtk/database/lib/poll-policy"
import { isTournamentPublished } from "@mtk/database/lib/publication-policy"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { requireFanContext } from "./fan-follows"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

/**
 * FAN-01 moderated tournament polls (locked writers, first slice:
 * schema-backed writers - dashboard UI follows).
 *
 * Authority and moderation mirrors the prizes/reactions precedents:
 *  - Creating and lifecycle are `tournament:update` in the exact active
 *    league (`requireActiveLeagueContext`), re-derived server-side, never a
 *    client argument. The question and options are OWNER-authored - this is
 *    where moderation lives: fans never write text anywhere in a poll.
 *  - Voting is `fan:follow` (`requireFanContext`): one active vote per fan
 *    per poll, switchable in place while the poll is open, and only on a
 *    PUBLISHED tournament. Votes are engagement only - nothing in scoring,
 *    standings, awards or any official decision reads them. Engagement
 *    writes are not audited (fan reactions precedent); owner lifecycle IS.
 *  - Closed is terminal. Reopening is refused: votes would resume under
 *    different visibility than they were given under.
 */

const createPollInputSchema = z.object({
  tournamentId: z.string().uuid(),
  question: z.string().max(400),
  options: z.array(z.unknown()).min(1),
}).strict()

const lifecycleInputSchema = z.object({
  pollId: z.string().uuid(),
  status: z.string(),
}).strict()

const voteInputSchema = z.object({
  pollId: z.string().uuid(),
  optionIndex: z.number().int(),
}).strict()

export type PollCreateResult = { pollId: string }

export type PollLifecycleResult =
  | { ok: true; status: "open" | "closed"; tournamentId: string }
  | { ok: false; reason: "poll_not_found" | "unknown_transition" | "terminal_closed" | "not_strings" | "too_few" | "too_many" | "empty_option" | "too_long" | "multiline" | "invalid_question" }

export type PollVoteResult = {
  action: "recorded" | "switched" | "refused"
  reason?: "poll_not_found" | "tournament_unpublished" | "not_open" | "unknown_option" | "not_a_poll"
  /** Fresh counts after a successful vote; absent when refused. */
  counts?: number[]
}

/** Create a DRAFT poll. Only owners; the options array is validated by the pure policy. */
export async function createTournamentPoll(input: unknown): Promise<PollCreateResult> {
  const parsed = createPollInputSchema.parse(input)
  const question = normalizePollQuestion(parsed.question)
  if (!question) throw new Error("The poll question must be a single line of 1-200 characters")
  const optionsResult = normalizePollOptions(parsed.options)
  if (!optionsResult.ok) throw new Error(`The poll options were refused (${optionsResult.reason})`)
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    // The tournament must exist in the SAME league.
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")

    const [inserted] = await tx
      .insert(tournamentPolls)
      .values({
        tenantId: context.tenantId,
        tournamentId: parsed.tournamentId,
        question,
        options: optionsResult.options,
        status: "draft",
        createdBy: context.actorId,
      })
      .returning({ id: tournamentPolls.id })
    if (!inserted) throw new Error("The poll could not be recorded. Please retry.")

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "POLL_RECORDED",
      path: "/actions/polls",
      statusCode: "200",
      payload: {
        tournamentId: parsed.tournamentId,
        pollId: inserted.id,
        question,
        options: optionsResult.options,
        status: "draft",
      },
    })
    return { pollId: inserted.id }
  })
}

/** Draft -> open -> closed lifecycle. Closed is terminal; the row is locked FOR UPDATE. */
export async function setTournamentPollStatus(input: unknown): Promise<PollLifecycleResult> {
  const parsed = lifecycleInputSchema.parse(input)
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    const [poll] = await tx
      .select({
        id: tournamentPolls.id, status: tournamentPolls.status,
        tournamentId: tournamentPolls.tournamentId,
      })
      .from(tournamentPolls)
      .where(and(
        eq(tournamentPolls.id, parsed.pollId),
        eq(tournamentPolls.tenantId, context.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!poll) return { ok: false, reason: "poll_not_found" as const }

    const decision = pollTransitionDecision(poll.status, parsed.status)
    if (!decision.allowed) return { ok: false, reason: decision.reason }

    await tx
      .update(tournamentPolls)
      .set({ status: decision.next, updatedAt: new Date() })
      .where(and(eq(tournamentPolls.id, poll.id), eq(tournamentPolls.tenantId, context.tenantId)))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "POLL_LIFECYCLE",
      path: "/actions/polls",
      statusCode: "200",
      payload: {
        pollId: poll.id,
        tournamentId: poll.tournamentId,
        before: { status: poll.status },
        after: { status: decision.next },
        changedFields: ["status"],
      },
    })
    return { ok: true, status: decision.next, tournamentId: poll.tournamentId }
  })
}

/**
 * The poll with its fresh per-option counts (aggregate only - never who voted
 * how). Used by the fan-facing poll surface; a refused/foreign poll id reads
 * as an empty result, never an error message leak.
 */
export async function readTournamentPollResults(
  tenantId: string,
  pollId: string,
): Promise<{ question: string; status: string; options: string[]; counts: number[]; total: number } | null> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(pollId)
  const [poll] = await db
    .select({
      question: tournamentPolls.question, status: tournamentPolls.status,
      options: tournamentPolls.options,
    })
    .from(tournamentPolls)
    .where(and(eq(tournamentPolls.id, pollId), eq(tournamentPolls.tenantId, tenantId)))
    .limit(1)
  if (!poll) return null
  const options = (Array.isArray(poll.options) ? poll.options : [])
    .filter((option): option is string => typeof option === "string")
  const rows = await db
    .select({ optionIndex: tournamentPollVotes.optionIndex, total: count() })
    .from(tournamentPollVotes)
    .where(and(
      eq(tournamentPollVotes.tenantId, tenantId),
      eq(tournamentPollVotes.pollId, pollId),
    ))
    .groupBy(tournamentPollVotes.optionIndex)
  const counts = options.map(() => 0)
  let total = 0
  for (const row of rows) {
    if (row.optionIndex >= 0 && row.optionIndex < counts.length) {
      const value = Number(row.total)
      counts[row.optionIndex] += value
      total += value
    }
  }
  return { question: poll.question, status: poll.status, options, counts, total }
}

/**
 * The fan's active option on one poll (or null). Foreign-league ids read as
 * no vote - the same fail-closed anonymity as the reaction reads.
 */
export async function readMyPollVote(tenantId: string, pollId: string): Promise<number | null> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(pollId)
  const context = await requireFanContext("fan:follow")
  if (context.tenantId !== tenantId) return null
  const [vote] = await db
    .select({ optionIndex: tournamentPollVotes.optionIndex })
    .from(tournamentPollVotes)
    .where(and(
      eq(tournamentPollVotes.tenantId, tenantId),
      eq(tournamentPollVotes.pollId, pollId),
      eq(tournamentPollVotes.userId, context.actorId),
    ))
    .limit(1)
  return vote?.optionIndex ?? null
}

/** Bound for the fan-facing poll list on the public tournament page. */
export const FAN_POLL_LIMIT = 5
/** Bound for the owner dashboard management list. */
export const POLL_MANAGEMENT_LIMIT = 50

export type TournamentPollSummary = {
  pollId: string
  question: string
  status: "draft" | "open" | "closed"
  options: string[]
  counts: number[]
  total: number
  createdAt: string
}

const POLL_STATUS_VALUES = ["draft", "open", "closed"] as const

/**
 * Shared loader: bounded polls of ONE tournament with a SINGLE grouped vote
 * query (poll, optionIndex) - aggregate counts only, never per-fan rows.
 * Unknown statuses from legacy rows are dropped; options are type-filtered.
 */
async function loadPollSummaries(
  tenantId: string,
  tournamentId: string,
  openOnly: boolean,
  limit: number,
): Promise<TournamentPollSummary[]> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(tournamentId)
  const polls = await db
    .select({
      id: tournamentPolls.id, question: tournamentPolls.question,
      status: tournamentPolls.status, options: tournamentPolls.options,
      createdAt: tournamentPolls.createdAt,
    })
    .from(tournamentPolls)
    .where(openOnly
      ? and(
          eq(tournamentPolls.tenantId, tenantId),
          eq(tournamentPolls.tournamentId, tournamentId),
          eq(tournamentPolls.status, "open"),
        )
      : and(
          eq(tournamentPolls.tenantId, tenantId),
          eq(tournamentPolls.tournamentId, tournamentId),
        ))
    .orderBy(desc(tournamentPolls.createdAt))
    .limit(limit)
  if (polls.length === 0) return []

  const voteRows = await db
    .select({ pollId: tournamentPollVotes.pollId, optionIndex: tournamentPollVotes.optionIndex, total: count() })
    .from(tournamentPollVotes)
    .where(and(
      eq(tournamentPollVotes.tenantId, tenantId),
      inArray(tournamentPollVotes.pollId, polls.map(poll => poll.id)),
    ))
    .groupBy(tournamentPollVotes.pollId, tournamentPollVotes.optionIndex)

  const countsByPoll = new Map<string, Map<number, number>>()
  for (const row of voteRows) {
    const inner = countsByPoll.get(row.pollId) ?? new Map<number, number>()
    inner.set(row.optionIndex, Number(row.total))
    countsByPoll.set(row.pollId, inner)
  }

  return polls.flatMap(poll => {
    if (!POLL_STATUS_VALUES.includes(poll.status as typeof POLL_STATUS_VALUES[number])) return []
    const options = (Array.isArray(poll.options) ? poll.options : [])
      .filter((option): option is string => typeof option === "string")
    const inner = countsByPoll.get(poll.id)
    const counts = options.map((_, index) => inner?.get(index) ?? 0)
    const total = counts.reduce((sum, value) => sum + value, 0)
    return [{
      pollId: poll.id,
      question: poll.question,
      status: poll.status as TournamentPollSummary["status"],
      options,
      counts,
      total,
      createdAt: poll.createdAt.toISOString(),
    }]
  })
}

/** Fan-facing list: only OPEN polls of one tournament, bounded newest-first. */
export function readFanTournamentPolls(
  tenantId: string,
  tournamentId: string,
): Promise<TournamentPollSummary[]> {
  return loadPollSummaries(tenantId, tournamentId, true, FAN_POLL_LIMIT)
}

/** Owner dashboard list: every status, bounded newest-first. */
export function readTournamentPollManagement(
  tenantId: string,
  tournamentId: string,
): Promise<TournamentPollSummary[]> {
  return loadPollSummaries(tenantId, tournamentId, false, POLL_MANAGEMENT_LIMIT)
}

/**
 * Fail-closed session read for the PUBLIC fan card: a signed-out visitor (or
 * a non-fan session) just cannot vote - the page renders read-only, and the
 * exact reason is never leaked to the unauthenticated surface.
 */
export async function readMyPollVoteSafe(
  tenantId: string,
  pollId: string,
): Promise<{ vote: number | null; canVote: boolean }> {
  try {
    const vote = await readMyPollVote(tenantId, pollId)
    return { vote, canVote: true }
  } catch {
    return { vote: null, canVote: false }
  }
}

/**
 * Record or switch the fan's vote on an OPEN poll of a PUBLISHED tournament.
 * Switching updates in place under the unique (poll, fan) index - changing
 * one's mind is not abuse. Returns fresh aggregate counts, never per-fan.
 */
export async function voteOnTournamentPoll(input: unknown): Promise<PollVoteResult> {
  const parsed = voteInputSchema.parse(input)
  const context = await requireFanContext("fan:follow")

  // (1) Poll gate: must exist in the fan's league, on a PUBLISHED tournament.
  const [poll] = await db
    .select({
      id: tournamentPolls.id, status: tournamentPolls.status,
      options: tournamentPolls.options, tournamentStatus: tournaments.status,
    })
    .from(tournamentPolls)
    .innerJoin(
      tournaments,
      and(eq(tournaments.id, tournamentPolls.tournamentId), eq(tournaments.tenantId, context.tenantId)),
    )
    .where(and(eq(tournamentPolls.id, parsed.pollId), eq(tournamentPolls.tenantId, context.tenantId)))
    .limit(1)
  if (!poll) return { action: "refused", reason: "poll_not_found" }
  if (!isTournamentPublished(poll.tournamentStatus)) {
    return { action: "refused", reason: "tournament_unpublished" }
  }

  // (2) Vote decision: open poll, real option index (switching allowed).
  const optionsCount = Array.isArray(poll.options)
    ? poll.options.filter(option => typeof option === "string").length
    : 0
  const decision = pollVoteDecision({ status: poll.status, optionsCount }, parsed.optionIndex)
  if (!decision.allowed) return { action: "refused", reason: decision.reason }

  const [existing] = await db
    .select({ optionIndex: tournamentPollVotes.optionIndex })
    .from(tournamentPollVotes)
    .where(and(
      eq(tournamentPollVotes.tenantId, context.tenantId),
      eq(tournamentPollVotes.pollId, parsed.pollId),
      eq(tournamentPollVotes.userId, context.actorId),
    ))
    .limit(1)

  if (existing) {
    if (existing.optionIndex !== decision.optionIndex) {
      await db
        .update(tournamentPollVotes)
        .set({ optionIndex: decision.optionIndex, updatedAt: new Date() })
        .where(and(
          eq(tournamentPollVotes.tenantId, context.tenantId),
          eq(tournamentPollVotes.pollId, parsed.pollId),
          eq(tournamentPollVotes.userId, context.actorId),
        ))
    }
  } else {
    // The unique (poll, fan) index makes a race insert a no-op - a duplicate
    // vote can never exist; a re-read below keeps counts fresh regardless.
    await db
      .insert(tournamentPollVotes)
      .values({
        tenantId: context.tenantId,
        pollId: parsed.pollId,
        userId: context.actorId,
        optionIndex: decision.optionIndex,
      })
      .onConflictDoNothing()
  }

  const results = await readTournamentPollResults(context.tenantId, parsed.pollId)
  return {
    action: existing ? (existing.optionIndex === decision.optionIndex ? "recorded" : "switched") : "recorded",
    counts: results?.counts ?? [],
  }
}
