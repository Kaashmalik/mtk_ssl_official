import { z } from "zod"

/**
 * FAN-02 notification delivery policy (pure).
 *
 * Every notification channel passes through this shared policy before a row is
 * written or a provider is called. Consent comes first, then quiet hours, then
 * channel wiring. Absence of a preferences row keeps the historical default:
 * the in-app bell stays on and external channels stay off (opt-in, fail-closed).
 *
 * Quiet hours are wall-clock minutes of day in the member's own IANA time zone
 * and gate INTERRUPTING channels (email/push/sms) — channels that reach a
 * sleeping person. The in-app bell deliberately never enters a quiet window:
 * it interrupts nothing until opened (it is a badge/inbox), so withholding its
 * rows would only lose history, not prevent an interruption. Today no
 * interrupting channel is wired (see `memberDeliveryDecision`), so quiet hours
 * surface as the recorded shared decision those channels' future provider
 * passes must call — the policy is the enforcement point, not a UI promise.
 */

export const NOTIFICATION_CHANNEL_TYPES = ["in_app", "email", "push", "sms"] as const
export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number]

export const MINUTE_OF_DAY_MAX = 1439

export type NotificationPreferencesInput = {
  inAppEnabled: boolean
  quietStartMinute: number | null
  quietEndMinute: number | null
  timeZone: string | null
}

/** A parsed, internally-consistent quiet window or the explicit no-window case. */
export type ParsedQuietWindow =
  | { kind: "none" }
  | { kind: "window"; start: number; end: number } // [start, end); may wrap midnight.

const minuteOfDay = z.number().int().min(0).max(MINUTE_OF_DAY_MAX)

export function parseQuietWindow(
  start: number | null,
  end: number | null,
): ParsedQuietWindow {
  if (start == null && end == null) return { kind: "none" }
  const parsedStart = minuteOfDay.safeParse(start)
  const parsedEnd = minuteOfDay.safeParse(end)
  // Both-or-neither is a schema/DB invariant; policy re-asserts it fail-closed.
  if (!parsedStart.success || !parsedEnd.success) return { kind: "none" }
  if (parsedStart.data === parsedEnd.data) return { kind: "none" }
  return { kind: "window", start: parsedStart.data, end: parsedEnd.data }
}

/** Wall-clock minutes of day in `timeZone`; null when the zone is unknown. */
export function wallClockMinutesInZone(date: Date, timeZone: string | null): number | null {
  if (!timeZone) return date.getUTCHours() * 60 + date.getUTCMinutes()
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(date)
    const hour = Number(parts.find(p => p.type === "hour")?.value)
    const minute = Number(parts.find(p => p.type === "minute")?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return ((hour % 24) * 60 + minute) % 1440
  } catch {
    return null
  }
}

/**
 * Whether `minuteOfDay` lies in the quiet window [start, end). Boundary rule:
 * the start minute IS quiet, the end minute is NOT (the window is half-open),
 * so a member resuming at exactly the end minute receives notifications.
 */
export function isWithinQuietHours(minuteOfDay: number, window: ParsedQuietWindow): boolean {
  if (window.kind === "none") return false
  if (window.start < window.end) {
    return minuteOfDay >= window.start && minuteOfDay < window.end
  }
  // Wraps midnight: e.g. 22:00 -> 07:00.
  return minuteOfDay >= window.start || minuteOfDay < window.end
}

export type DeliveryDecision = {
  channel: NotificationChannelType
  allowed: boolean
  /** Machine-readable refusal reason; surfaced honestly, never hidden. */
  reason:
    | "ok"
    | "consent_off"
    | "quiet_hours"
    | "channel_unwired"
}

/**
 * The single shared dispatch decision for one member, one channel, now.
 *
 * Order of evaluation (each subsequent check only sees the survivors):
 *   1. consent (in-app defaults ON when no row exists, everything else OFF),
 *   2. quiet hours — interrupting channels only; the in-app inbox is exempt
 *      (it wakes nobody). Evaluated BEFORE wiring so a member's saved window
 *      is observable in the decision today, while no external channel is yet
 *      wired. An unresolvable member zone falls back to UTC minutes rather
 *      than failing open: the window stays enforced, possibly an hour off.
 *   3. channel wiring — an unwired channel is refused even with full consent,
 *      because pretending to deliver would fabricate the send.
 */
export function memberDeliveryDecision(input: {
  channel: NotificationChannelType
  prefs: NotificationPreferencesInput | null
  now: Date
}): DeliveryDecision {
  const { channel, prefs, now } = input
  if (!prefs) {
    return channel === "in_app"
      ? { channel, allowed: true, reason: "ok" }
      : { channel, allowed: false, reason: "consent_off" }
  }
  if (channel === "in_app" && !prefs.inAppEnabled) {
    return { channel, allowed: false, reason: "consent_off" }
  }
  if (channel !== "in_app") {
    const window = parseQuietWindow(prefs.quietStartMinute, prefs.quietEndMinute)
    if (window.kind === "window") {
      const minutes = wallClockMinutesInZone(now, prefs.timeZone)
      const resolved = minutes ?? wallClockMinutesInZone(now, null)
      if (resolved == null || isWithinQuietHours(resolved, window)) {
        return { channel, allowed: false, reason: "quiet_hours" }
      }
    }
  }
  const WIRING: Record<NotificationChannelType, boolean> = {
    in_app: true,
    // No external provider is integrated; claiming to "send" email/push/sms
    // would fabricate delivery. Policy reports them honestly as unwired.
    email: false,
    push: false,
    sms: false,
  }
  if (!WIRING[channel]) return { channel, allowed: false, reason: "channel_unwired" }
  return { channel, allowed: true, reason: "ok" }
}
