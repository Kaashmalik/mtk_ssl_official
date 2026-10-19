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
  | { state: "provider_accepted"; ok: number; total: number }
  | { state: "provider_refused"; ok: number; total: number; error: string }

/**
 * Sends ONE notification to the member's bounded token set. Returns the
 * honest outcome: accepted only when EVERY token was accepted by the API.
 */export async function sendPushToTokens(
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

  // Expo replies with one receipt per message; a malformed body is a refusal,
  // not an assumption of success.
  let body: { data?: Array<{ status?: string }> } | null = null
  try {
    body = (await response.json()) as { data?: Array<{ status?: string }> }
  } catch {
    return { state: "provider_refused", ok: 0, total, error: "expo_response_unreadable" }
  }
  const receipts = Array.isArray(body?.data) ? body.data : null
  if (!receipts || receipts.length !== total) {
    return { state: "provider_refused", ok: 0, total, error: "expo_receipt_count_mismatch" }
  }
  const ok = receipts.filter((r) => r.status === "ok").length
  if (ok < total) {
    return { state: "provider_refused", ok, total, error: `expo_partial_${ok}of${total}` }
  }
  return { state: "provider_accepted", ok, total }
}
