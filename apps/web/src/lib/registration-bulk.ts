import { z } from "zod"
import { approveLeagueRegistration, rejectLeagueRegistration } from "@/lib/registration-management"

/**
 * Batch 120: BULK review for the owner console. This module NEVER touches the
 * database itself — it composes the hardened single commands, each of which
 * carries its own transaction, revalidation of the window/squad/authority
 * rules, and its own audit event. Bulk therefore cannot weaken any invariant
 * the singles enforce, and every entry keeps its own truthful audit trail.
 *
 * Honesty rules:
 * - The selection is validated and BOUNDED (at most 25) before any database
 *   work; duplicates and malformed ids are refused up front.
 * - Items are attempted SEQUENTIALLY: no new lock-order surface, and one
 *   item's failure (already reviewed, tournament full, payment missing) is
 *   isolated and reported — the remaining items are still attempted.
 * - The result array is the truth: one outcome per id, `ok: false` with the
 *   real error message, never a fabricated aggregate.
 */
export const BULK_REVIEW_LIMIT = 25

const bulkReviewSchema = z.object({
  operation: z.enum(["approve", "reject"]),
  ids: z.array(z.string().uuid()).min(1).max(BULK_REVIEW_LIMIT),
  reason: z.string().trim().min(1).max(500).optional(),
})

export type BulkReviewOperation = "approve" | "reject"

export type BulkReviewOutcome =
  | { id: string; ok: true; status: string; tournamentId: string }
  | { id: string; ok: false; error: string }

export async function bulkReviewLeagueRegistrations(
  clerkId: string,
  tenantId: string,
  input: { operation: BulkReviewOperation; ids: string[]; reason?: string },
): Promise<{ results: BulkReviewOutcome[] }> {
  const { operation, ids, reason } = bulkReviewSchema.parse(input)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate registration ids in the bulk selection")
  }
  if (operation === "reject" && !reason) {
    throw new Error("Provide a reason for rejecting the registrations")
  }

  const results: BulkReviewOutcome[] = []
  for (const id of ids) {
    try {
      const updated = operation === "approve"
        ? await approveLeagueRegistration(clerkId, tenantId, id)
        : await rejectLeagueRegistration(clerkId, tenantId, id, reason!)
      results.push({ id, ok: true, status: updated.status, tournamentId: updated.tournamentId })
    } catch (error) {
      results.push({
        id,
        ok: false,
        error: error instanceof Error ? error.message : "This registration could not be reviewed",
      })
    }
  }
  return { results }
}
