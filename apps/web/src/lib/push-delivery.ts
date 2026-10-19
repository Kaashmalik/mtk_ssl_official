/**
 * B162: push-channel delivery for FAN-02 notifications, via the Expo push
 * API. Mirrors the honesty rules of the B161 email path:
 *
 * - `notificationPushReady()` is the deployment wiring gate: nothing is ever
 *   attempted (let alone claimed sent) without the flag AND an access token.
 * - The provider call happens AFTER the consent transaction commits (the
 *   dispatch lib owns the sequencing); `provider_accepted` means the Expo API
 *   took the message — never that a device displayed it or a human read it.
 * - Per-token outcomes are summarized on the notification row
 *   (`<ok>ok/<total>`), so a partial failure is visible, not smoothed over.
 * - The device fan-out is bounded (PUSH_TOKEN_LIMIT): a pathological token
 *   store cannot fan a single notification into unbounded provider traffic.
 * - B163: ok send tickets keep their receiptIds; the REAL per-message verdict
 *   arrives through chasePushReceipts (the cron-driven receipts chase).
 */

import { z } from "zod"

/** Maximum device tokens one member's single notification fans out to. */
export const PUSH_TOKEN_LIMIT = 10

const expoTokenSchema = z.string().min(8).max(255)

export function notificationPushReady(): boolean {
  return (
    process.env.NOTIFICATION_PUSH_READY === "true" &&
    Boolean(process.env.EXPO_ACCESS_TOKEN?.trim())
  )
}

const pushContentSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().max(500),
  type: z.string().min(1).max(64),
  tenantId: z.string().uuid(),
  dedupKey: z.string().min(8).max(120),
})

export type PushSendOutcome =
  | { state: "provider_accepted"; ok: number; total: number; receiptIds: string[] }
  | { state: "provider_refused"; ok: number; total: number; error: string }

/**
 * Sends ONE notification to the member's bounded token set. Returns the
 * honest outcome: accepted only when EVERY token was accepted by the API.
 */
export async function sendPushToTokens(
  rawTokens: string[],
  content: z.infer<typeof pushContentSchema>,
): Promise<PushSendOutcome> {
  const tokens = rawTokens.map((t) => expoTokenSchema.parse(t)).slice(0, PUSH_TOKEN_LIMIT)
  const total = tokens.length
  const apiKey = process.env.EXPO_ACCESS_TOKEN?.trim()
  if (!apiKey || total === 0) {
    return { state: "provider_refused", ok: 0, total, error: total === 0 ? "no_tokens" : "provider_unconfigured" }
  }

  const messages = tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    sound: "default" as const,
    data: { type: content.type, tenantId: content.tenantId, dedupKey: content.dedupKey },
  }))

  let response: Response
  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    })
  } catch {
    return { state: "provider_refused", ok: 0, total, error: "network_unknown" }
  }
  if (!response.ok) {
    return { state: "provider_refused", ok: 0, total, error: `expo_http_${response.status}` }
  }

  // Expo replies with one ticket per message; a malformed body is a refusal,
  // not an assumption of success. Tickets marked ok carry a receiptId - the
  // ACTUAL delivery verdict arrives later, through chasePendingPushReceipts.
  let body: { data?: Array<{ status?: string; receiptId?: string }> } | null = null
  try {
    body = (await response.json()) as { data?: Array<{ status?: string; receiptId?: string }> }
  } catch {
    return { state: "provider_refused", ok: 0, total, error: "expo_response_unreadable" }
  }
  const tickets = Array.isArray(body?.data) ? body.data : null
  if (!tickets || tickets.length !== total) {
    return { state: "provider_refused", ok: 0, total, error: "expo_receipt_count_mismatch" }
  }
  const okTickets = tickets.filter((t) => t.status === "ok")
  const receiptIds = okTickets.map((t) => t.receiptId).filter((id): id is string => typeof id === "string")
  if (okTickets.length < total) {
    return { state: "provider_refused", ok: okTickets.length, total, error: `expo_partial_${okTickets.length}of${total}` }
  }
  return { state: "provider_accepted", ok: okTickets.length, total, receiptIds }
}

/**
 * B163: the FAN-02 delivery-tracking loop. The send ticket proves only that
 * Expo took the message; the receipts endpoint returns the REAL per-message
 * verdict. Returns one entry per RECEIVED receipt: "ok" = delivered,
 * otherwise the error string (e.g. DeviceNotRegistered). Receipts that Expo
 * has not produced yet are left ABSENT from the map — "not yet available"
 * is a third state the caller must keep pending, never read as delivered.
 */
export async function chasePushReceipts(receiptIds: string[]): Promise<Record<string, string>> {
  const ids = receiptIds.map((id) => id.trim()).filter((id) => id.length > 0).slice(0, 1000)
  const verdicts: Record<string, string> = {}
  if (ids.length === 0) return verdicts
  const apiKey = process.env.EXPO_ACCESS_TOKEN?.trim()
  if (!apiKey) return Object.fromEntries(ids.map((id) => [id, "provider_unconfigured"]))

  for (let offset = 0; offset < ids.length; offset += 1000) {
    const chunk = ids.slice(offset, offset + 1000)
    let response: Response
    try {
      response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      })
    } catch {
      for (const id of chunk) verdicts[id] = "network_unknown"
      continue
    }
    if (!response.ok) {
      for (const id of chunk) verdicts[id] = `receipts_http_${response.status}`
      continue
    }
    let body: { data?: Record<string, { status?: string; message?: string; details?: { error?: string } }> } | null = null
    try {
      body = (await response.json()) as { data?: Record<string, { status?: string; message?: string; details?: { error?: string } }> }
    } catch {
      for (const id of chunk) verdicts[id] = "receipts_response_unreadable"
      continue
    }
    const receipts = body?.data ?? {}
    for (const id of chunk) {
      const receipt = receipts[id]
      if (!receipt) continue // not available yet — stays absent (pending)
      if (receipt.status === "ok") {
        verdicts[id] = "receipt_ok"
        continue
      }
      verdicts[id] = receipt.details?.error || receipt.message || "receipt_error"
    }
  }
  return verdicts
}
