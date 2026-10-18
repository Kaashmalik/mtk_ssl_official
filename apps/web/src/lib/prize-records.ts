import { randomUUID } from "crypto"
import { db, tournamentPrizes, tournaments, auditLogs } from "@mtk/database"
import { normalizePrizeAmount, prizeCanBeEdited, prizeCanBeSuperseded } from "@mtk/database/lib/prize-policy"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { and, asc, eq, isNull } from "drizzle-orm"
import { z } from "zod"

/**
 * PUB-05 tournament-prize management (first slice: schema-backed writer).
 *
 * Authority: `tournament:update` in the exact active league — identity,
 * membership and permission are re-derived server-side by
 * `requireActiveLeagueContext` and never taken from a client argument. Every
 * mutation serializes on a `FOR UPDATE` read of the prize row inside the
 * transaction, tenant-pinned through the tournament row first, so a prize can
 * neither drift across leagues nor race two organizers.
 *
 * Lifecycle truths enforced here (mirroring the shared pure policy):
 *  - Only DRAFT rows are editable. Approval is one-way and freezes the row.
 *  - A payout is recordable exactly once, on an approved prize only, and the
 *    record is the LEAGUE'S OWN truthful statement ("recordedPayoutAt", never
 *    presented as a platform-verified payment). A second, differing payout
 *    record is refused rather than silently rewriting the history; an
 *    identical replay is a pure read with no duplicate audit row.
 *  - Amounts normalize through the shared 2dp guard or the write is refused.
 */

const currencyPattern = /^[A-Z]{3}$/

const savePrizeInputSchema = z.object({
  tournamentId: z.string().uuid(),
  /** Null = create a new draft; set = update that existing draft. */
  prizeId: z.string().uuid().nullish(),
  /**
   * Correction flag: with prizeId set and `supersede: true`, an APPROVED
   * prize is never edited in place — the new values become a fresh DRAFT and
   * the frozen row is marked superseded (provenance chains the two). Drafts
   * are edited directly and refuse this flag.
   */
  supersede: z.boolean().nullish(),
  categoryName: z.string().trim().min(1).max(120),
  placement: z.string().trim().min(1).max(120).nullish(),
  /** Exact 2dp decimal string the numeric(12,2) column stores; null = non-cash. */
  amount: z.string().nullish(),
  currency: z.string().regex(currencyPattern).nullish(),
  sponsor: z.string().trim().min(1).max(200).nullish(),
}).strict()

export type SavePrizeInput = z.infer<typeof savePrizeInputSchema>

export type PrizeWriteResult = {
  tournamentId: string
  prizeId: string
  changed: boolean
}

/** Create or update a DRAFT prize. An approved prize is immutable in this slice. */
export async function saveTournamentPrize(input: unknown): Promise<PrizeWriteResult> {
  const parsed = savePrizeInputSchema.parse(input)
  const amount = parsed.amount == null || parsed.amount === "" ? null : normalizePrizeAmount(parsed.amount)
  if (parsed.amount != null && parsed.amount !== "" && amount == null) {
    throw new Error("The prize amount must be a non-negative number with at most two decimal places")
  }
  if (parsed.amount == null || parsed.amount === "") {
    if (parsed.currency) throw new Error("A currency is only meaningful together with an amount")
  }
  const placement = parsed.placement?.trim() || null
  const sponsor = parsed.sponsor?.trim() || null
  const currency = amount == null ? "PKR" : (parsed.currency?.trim() || "PKR")
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    // (1) The tournament must exist in the SAME league.
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")

    if (parsed.prizeId == null) {
      // (2a) Create a new draft prize.
      const [inserted] = await tx
        .insert(tournamentPrizes)
        .values({
          tenantId: context.tenantId,
          tournamentId: parsed.tournamentId,
          categoryName: parsed.categoryName,
          placement,
          amount,
          currency,
          sponsor,
          status: "draft",
          createdBy: context.actorId,
        })
        .returning({ id: tournamentPrizes.id })
      if (!inserted) throw new Error("The prize could not be recorded. Please retry.")

      await tx.insert(auditLogs).values({
        requestId: randomUUID(),
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.role,
        method: "PRIZE_RECORDED",
        path: "/actions/prizes",
        statusCode: "200",
        payload: {
          tournamentId: parsed.tournamentId,
          prizeId: inserted.id,
          categoryName: parsed.categoryName,
          placement,
          amount,
          currency: amount == null ? null : currency,
          sponsor,
          status: "draft",
        },
      })
      return { tournamentId: parsed.tournamentId, prizeId: inserted.id, changed: true }
    }

    // (2b) Update an EXISTING draft, or CORRECT an approved prize via supersede;
    // serialize on the row lock.
    const [prize] = await tx
      .select({ id: tournamentPrizes.id, status: tournamentPrizes.status, categoryName: tournamentPrizes.categoryName, placement: tournamentPrizes.placement, amount: tournamentPrizes.amount, currency: tournamentPrizes.currency, sponsor: tournamentPrizes.sponsor, supersededAt: tournamentPrizes.supersededAt })
      .from(tournamentPrizes)
      .where(and(
        eq(tournamentPrizes.id, parsed.prizeId),
        eq(tournamentPrizes.tournamentId, parsed.tournamentId),
        eq(tournamentPrizes.tenantId, context.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!prize) throw new Error("Forbidden: prize not found in this tournament")
    if (parsed.supersede === true && prizeCanBeEdited(prize)) {
      throw new Error("Only an approved prize can be superseded — edit the draft directly")
    }
    if (!prizeCanBeEdited(prize) && parsed.supersede !== true) {
      throw new Error("Approved prizes are frozen records and can no longer be edited")
    }

    if (parsed.supersede === true) {
      // (2c) APPROVED-PRIZE CORRECTION via supersede. The frozen row keeps its
      // history (including any recorded payout); the new values become a fresh
      // draft that must be approved on its own merits.
      if (!prizeCanBeSuperseded(prize)) {
        throw new Error("This prize has already been superseded — correct its active replacement instead")
      }
      const unchanged = prize.categoryName === parsed.categoryName
        && (prize.placement ?? null) === placement
        && (prize.amount ?? null) === amount
        && prize.currency === currency
        && (prize.sponsor ?? null) === sponsor
      if (unchanged) {
        throw new Error("A correction must change at least one prize field")
      }

      const [inserted] = await tx
        .insert(tournamentPrizes)
        .values({
          tenantId: context.tenantId,
          tournamentId: parsed.tournamentId,
          categoryName: parsed.categoryName,
          placement,
          amount,
          currency,
          sponsor,
          status: "draft",
          createdBy: context.actorId,
        })
        .returning({ id: tournamentPrizes.id })
      if (!inserted) throw new Error("The prize correction could not be recorded. Please retry.")

      await tx.update(tournamentPrizes)
        .set({ supersededAt: new Date(), supersededByPrizeId: inserted.id, updatedAt: new Date() })
        .where(eq(tournamentPrizes.id, prize.id))

      await tx.insert(auditLogs).values({
        requestId: randomUUID(),
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.role,
        method: "PRIZE_CORRECTED",
        path: "/actions/prizes",
        statusCode: "200",
        payload: {
          tournamentId: parsed.tournamentId,
          supersededPrizeId: prize.id,
          newPrizeId: inserted.id,
          before: { categoryName: prize.categoryName, placement: prize.placement, amount: prize.amount, currency: prize.currency, sponsor: prize.sponsor },
          after: { categoryName: parsed.categoryName, placement, amount, currency: amount == null ? null : currency, sponsor },
        },
      })
      return { tournamentId: parsed.tournamentId, prizeId: inserted.id, changed: true }
    }

    const unchanged = prize.categoryName === parsed.categoryName
      && (prize.placement ?? null) === placement
      && (prize.amount ?? null) === amount
      && prize.currency === currency
      && (prize.sponsor ?? null) === sponsor
    if (unchanged) {
      return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: false }
    }

    await tx.update(tournamentPrizes)
      .set({ categoryName: parsed.categoryName, placement, amount, currency, sponsor, updatedAt: new Date() })
      .where(eq(tournamentPrizes.id, prize.id))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "PRIZE_UPDATED",
      path: "/actions/prizes",
      statusCode: "200",
      payload: {
        tournamentId: parsed.tournamentId,
        prizeId: prize.id,
        before: { categoryName: prize.categoryName, placement: prize.placement, amount: prize.amount, currency: prize.currency, sponsor: prize.sponsor },
        after: { categoryName: parsed.categoryName, placement, amount, currency: amount == null ? null : currency, sponsor },
      },
    })
    return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: true }
  }, { isolationLevel: "read committed" })
}

const approvePrizeInputSchema = z.object({
  tournamentId: z.string().uuid(),
  prizeId: z.string().uuid(),
}).strict()

/**
 * One-way draft -> approved approval. The resulting row is frozen recorded
 * truth; re-approving an approved prize replays as a pure read (no write, no
 * duplicate audit), matching the awards/cancelled-fixture replay precedent.
 */
export async function approveTournamentPrize(input: unknown): Promise<PrizeWriteResult> {
  const parsed = approvePrizeInputSchema.parse(input)
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")

    const [prize] = await tx
      .select({ id: tournamentPrizes.id, status: tournamentPrizes.status, approvedAt: tournamentPrizes.approvedAt })
      .from(tournamentPrizes)
      .where(and(
        eq(tournamentPrizes.id, parsed.prizeId),
        eq(tournamentPrizes.tournamentId, parsed.tournamentId),
        eq(tournamentPrizes.tenantId, context.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!prize) throw new Error("Forbidden: prize not found in this tournament")
    if (prize.status !== "draft") {
      // Replay (or a hyperactive double-click): already approved, nothing to do.
      return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: false }
    }

    const approvedAt = new Date()
    await tx.update(tournamentPrizes)
      .set({ status: "approved", approvedBy: context.actorId, approvedAt })
      .where(eq(tournamentPrizes.id, prize.id))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "PRIZE_APPROVED",
      path: "/actions/prizes",
      statusCode: "200",
      payload: {
        tournamentId: parsed.tournamentId,
        prizeId: prize.id,
        approvedAt: approvedAt.toISOString(),
      },
    })
    return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: true }
  }, { isolationLevel: "read committed" })
}

const payoutInputSchema = approvePrizeInputSchema.extend({
  reference: z.string().trim().min(1).max(200).nullish(),
  note: z.string().trim().min(1).max(500).nullish(),
}).strict()

export type RecordPayoutInput = z.infer<typeof payoutInputSchema>

/**
 * Record the league's payout of an approved prize — exactly once. The record
 * is the league's own truthful statement that it paid; the platform does not
 * verify fund transfer and nothing downstream may claim it does. An identical
 * replay is a pure read; a DIFFERING second record is refused so the league's
 * payout history can never be silently rewritten.
 */
export async function recordPrizePayout(input: unknown): Promise<PrizeWriteResult> {
  const parsed = payoutInputSchema.parse(input)
  const reference = parsed.reference?.trim() || null
  const note = parsed.note?.trim() || null
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")

    const [prize] = await tx
      .select({
        id: tournamentPrizes.id,
        status: tournamentPrizes.status,
        recordedPayoutAt: tournamentPrizes.recordedPayoutAt,
        payoutReference: tournamentPrizes.payoutReference,
        payoutNote: tournamentPrizes.payoutNote,
      })
      .from(tournamentPrizes)
      .where(and(
        eq(tournamentPrizes.id, parsed.prizeId),
        eq(tournamentPrizes.tournamentId, parsed.tournamentId),
        eq(tournamentPrizes.tenantId, context.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!prize) throw new Error("Forbidden: prize not found in this tournament")
    if (prize.status !== "approved") {
      throw new Error("Only approved prizes can have a payout recorded")
    }
    if (prize.recordedPayoutAt != null) {
      // Identical replay: pure read, no duplicate audit. A DIFFERING second
      // record is refused — the league's payout history is never rewritten.
      if (prize.payoutReference === reference && prize.payoutNote === note) {
        return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: false }
      }
      throw new Error("A payout has already been recorded for this prize")
    }

    const recordedPayoutAt = new Date()

    await tx.update(tournamentPrizes)
      .set({ recordedPayoutAt, payoutReference: reference, payoutNote: note })
      .where(eq(tournamentPrizes.id, prize.id))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: "PRIZE_PAYOUT_RECORDED",
      path: "/actions/prizes",
      statusCode: "200",
      payload: {
        tournamentId: parsed.tournamentId,
        prizeId: prize.id,
        recordedPayoutAt: recordedPayoutAt.toISOString(),
        payoutReference: reference,
        payoutNote: note,
      },
    })
    return { tournamentId: parsed.tournamentId, prizeId: prize.id, changed: true }
  }, { isolationLevel: "read committed" })
}

/** Bounded management-list size (house bound; overflow is disclosed, not hidden). */
const PRIZE_MANAGER_BOUND = 200

export type PrizeManagementRow = {
  id: string
  categoryName: string
  placement: string | null
  amount: string | null
  currency: string
  sponsor: string | null
  status: "draft" | "approved"
  recordedPayoutAt: Date | null
}

export type PrizeManagementContext = {
  prizes: PrizeManagementRow[]
  complete: boolean
}

/**
 * Bounded read of this tournament's ACTIVE prizes for the organizer's
 * management card — superseded rows are correction history and deliberately
 * absent here (the audit trail holds the full chain). The caller resolves
 * authority (`canEdit`); every write re-checks it. Payout reference/note text
 * is NOT returned — the list discloses THAT a payout was recorded, not its
 * financial details, which stay in the audit trail.
 */
export async function readPrizeManagementContext(
  tenantId: string,
  tournamentId: string,
): Promise<PrizeManagementContext> {
  const rows = await db
    .select({
      id: tournamentPrizes.id,
      categoryName: tournamentPrizes.categoryName,
      placement: tournamentPrizes.placement,
      amount: tournamentPrizes.amount,
      currency: tournamentPrizes.currency,
      sponsor: tournamentPrizes.sponsor,
      status: tournamentPrizes.status,
      recordedPayoutAt: tournamentPrizes.recordedPayoutAt,
    })
    .from(tournamentPrizes)
    .where(and(
      eq(tournamentPrizes.tenantId, tenantId),
      eq(tournamentPrizes.tournamentId, tournamentId),
      isNull(tournamentPrizes.supersededAt),
    ))
    .orderBy(asc(tournamentPrizes.createdAt), asc(tournamentPrizes.id))
    .limit(PRIZE_MANAGER_BOUND + 1)
  return {
    prizes: rows.slice(0, PRIZE_MANAGER_BOUND),
    complete: rows.length <= PRIZE_MANAGER_BOUND,
  }
}
