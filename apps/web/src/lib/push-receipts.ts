import { db, notifications, pushTokens } from "@mtk/database"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { chasePushReceipts } from "./push-delivery"
import { z } from "zod"

/**
 * B163: the FAN-02 provider delivery-tracking loop (the clause the B162
 * batch honestly left open). The send ticket only proves Expo TOOK the
 * message; the receipts endpoint holds the real verdict, available some time
 * after the send. This is a BOUNDED, idempotent, cron-driven pass:
 *
 * - picks channel=push rows still carrying an un-chased receipt list
 *   (deliveryState provider_accepted, receiptsChased absent), bounded per
 *   run, never older than the receipt retention window;
 * - chases the receipts; receipts Expo has not produced yet are "pending":
 *   the row is left untouched so a LATER run re-chases (never promoted to
 *   delivered on absence);
 * - only when every receipt is confirmed ok does the loop close
 *   (receiptsChased + receiptsOk) — provider_accepted remains the state;
 * - any real error receipt downgrades the row to provider_refused with the
 *   machine-readable receipt error — the send ticket's optimism is
 *   corrected by the deeper truth, not papered over;
 * - DeviceNotRegistered additionally DEACTIVATES the offending token
 *   (data.receiptTokens pairs 1:1 with receiptIds), so a dead device stops
 *   consuming the bounded fan-out.
 */

const ROW_LIMIT_PER_RUN = 50
/** Receipts live ~1 day at Expo; older pending rows stop being chased. */
const CHASE_WINDOW_DAYS = 7

const chaseRowSchema = z.object({
  dedupKey: z.string().min(8).max(120),
  receiptIds: z.array(z.string().min(1).max(255)).min(1).max(1000),
  receiptTokens: z.array(z.string().min(1).max(255)).max(1000).optional(),
})

export type PushReceiptsChaseSummary = {
  rowsExamined: number
  rowsClosedOk: number
  rowsDowngraded: number
  rowsStillPending: number
  tokensDeactivated: number
}

export async function chasePendingPushReceipts(now = new Date()): Promise<PushReceiptsChaseSummary> {
  const summary: PushReceiptsChaseSummary = { rowsExamined: 0, rowsClosedOk: 0, rowsDowngraded: 0, rowsStillPending: 0, tokensDeactivated: 0 }
  const cutoff = new Date(now.getTime() - CHASE_WINDOW_DAYS * 86_400_000)

  const rows = await db
    .select({ id: notifications.id, data: notifications.data })
    .from(notifications)
    .where(and(
      eq(notifications.channel, "push"),
      gte(notifications.createdAt, cutoff),
      sql`${notifications.data} ->> 'deliveryState' = 'provider_accepted'`,
      sql`jsonb_typeof(${notifications.data} -> 'receiptIds') = 'array'`,
      sql`${notifications.data} -> 'receiptsChased' IS NULL`,
    ))
    .limit(ROW_LIMIT_PER_RUN)

  for (const row of rows) {
    const parsed = chaseRowSchema.safeParse(row.data)
    if (!parsed.success) {
      // Malformed ledger rows are left alone for manual attention — chased
      // with guessed fields they would produce fabricated verdicts.
      continue
    }
    const { receiptIds, receiptTokens, dedupKey } = parsed.data

    const verdicts = await chasePushReceipts(receiptIds)
    const received = Object.entries(verdicts)
    // Nothing came back at all: Expo has not produced the receipts yet.
    // Leave the row exactly as it is; a later run re-chases.
    if (received.length === 0) {
      summary.rowsExamined += 1
      summary.rowsStillPending += 1
      continue
    }

    const baseData = { ...(row.data as Record<string, unknown>), dedupKey }
    const errors = received.filter(([, verdict]) => verdict !== "receipt_ok")

    if (errors.length === 0) {
      // Every receipt confirmed delivered: the loop closes cleanly.
      summary.rowsExamined += 1
      summary.rowsClosedOk += 1
      await db.update(notifications)
        .set({ data: { ...baseData, receiptsChased: now.toISOString(), receiptsOk: receiptIds.length } })
        .where(eq(notifications.id, row.id))
      continue
    }

    summary.rowsExamined += 1
    summary.rowsDowngraded += 1
    // Deactivate dead devices so they stop consuming the bounded fan-out.
    const deadTokens: string[] = []
    if (receiptTokens && receiptTokens.length === receiptIds.length) {
      for (const [receiptId, verdict] of errors) {
        if (verdict !== "DeviceNotRegistered") continue
        const index = receiptIds.indexOf(receiptId)
        const token = index >= 0 ? receiptTokens[index] : undefined
        if (token) deadTokens.push(token)
      }
    }
    if (deadTokens.length > 0) {
      await db.update(pushTokens)
        .set({ isActive: false, lastUsedAt: now })
        .where(inArray(pushTokens.token, deadTokens))
      summary.tokensDeactivated += deadTokens.length
    }

    await db.update(notifications)
      .set({
        data: {
          ...baseData,
          receiptsChased: now.toISOString(),
          deliveryState: "provider_refused",
          deliveryError: `receipt_${errors[0][1]}`,
          receiptVerdicts: verdicts,
        },
      })
      .where(eq(notifications.id, row.id))
  }

  return summary
}
