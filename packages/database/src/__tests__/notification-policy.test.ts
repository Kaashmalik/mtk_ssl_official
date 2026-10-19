import { describe, expect, it } from "vitest"
import {
  memberDeliveryDecision,
  isWithinQuietHours,
  parseQuietWindow,
  wallClockMinutesInZone,
  type NotificationPreferencesInput,
} from "../lib/notification-policy"

const UTC_NOON = new Date("2026-10-17T12:00:00Z") // 12:00 UTC, 17:00 Karachi.
const UTC_0130 = new Date("2026-10-17T01:30:00Z") // 01:30 UTC, 06:30 Karachi.
const KARACHI = "Asia/Karachi"

function prefs(overrides: Partial<NotificationPreferencesInput> = {}): NotificationPreferencesInput {
  return { inAppEnabled: true, emailEnabled: true, quietStartMinute: null, quietEndMinute: null, timeZone: null, ...overrides }
}

describe("parseQuietWindow", () => {
  it("accepts both-minutes-set windows and normalizes the no-window case", () => {
    expect(parseQuietWindow(22 * 60, 7 * 60)).toEqual({ kind: "window", start: 1320, end: 420 })
    expect(parseQuietWindow(null, null)).toEqual({ kind: "none" })
  })

  it("fails closed to no-window on half-set, equal, out-of-range or non-integer values", () => {
    expect(parseQuietWindow(22 * 60, null)).toEqual({ kind: "none" })
    expect(parseQuietWindow(null, 7 * 60)).toEqual({ kind: "none" })
    expect(parseQuietWindow(600, 600)).toEqual({ kind: "none" })
    expect(parseQuietWindow(-1, 600)).toEqual({ kind: "none" })
    expect(parseQuietWindow(600, 1440)).toEqual({ kind: "none" })
    expect(parseQuietWindow(600.5, 660)).toEqual({ kind: "none" })
  })
})

describe("wallClockMinutesInZone", () => {
  it("converts a real instant through a real IANA zone", () => {
    expect(wallClockMinutesInZone(UTC_NOON, KARACHI)).toBe(17 * 60)
    expect(wallClockMinutesInZone(UTC_NOON, null)).toBe(12 * 60)
  })

  it("returns null for an unknown zone (callers decide the fallback)", () => {
    expect(wallClockMinutesInZone(UTC_NOON, "Mars/Olympus")).toBeNull()
  })

  it("handles a day rollover inside the zone (UTC 23:xx stays < 1440)", () => {
    expect(wallClockMinutesInZone(new Date("2026-10-17T23:59:00Z"), KARACHI)).toBe(4 * 60 + 59)
  })
})

describe("isWithinQuietHours", () => {
  it("keeps a same-day window half-open: start is quiet, end is not", () => {
    const window = parseQuietWindow(13 * 60, 15 * 60) as { kind: "window"; start: number; end: number }
    expect(isWithinQuietHours(13 * 60, window)).toBe(true)
    expect(isWithinQuietHours(14 * 60, window)).toBe(true)
    expect(isWithinQuietHours(15 * 60, window)).toBe(false)
  })

  it("supports a window that wraps midnight", () => {
    const window = parseQuietWindow(22 * 60, 7 * 60) as { kind: "window"; start: number; end: number }
    expect(isWithinQuietHours(22 * 60, window)).toBe(true)
    expect(isWithinQuietHours(23 * 60, window)).toBe(true)
    expect(isWithinQuietHours(5 * 60, window)).toBe(true)
    expect(isWithinQuietHours(7 * 60, window)).toBe(false)
    expect(isWithinQuietHours(12 * 60, window)).toBe(false)
  })

  it("never quiet-houses without a window", () => {
    expect(isWithinQuietHours(22 * 60, { kind: "none" })).toBe(false)
  })
})

describe("memberDeliveryDecision", () => {
  it("keeps the historical default without a saved row: in-app on, external channels off", () => {
    expect(memberDeliveryDecision({ channel: "in_app", prefs: null, now: UTC_NOON }))
      .toEqual({ channel: "in_app", allowed: true, reason: "ok" })
    expect(memberDeliveryDecision({ channel: "email", prefs: null, now: UTC_NOON }))
      .toEqual({ channel: "email", allowed: false, reason: "consent_off" })
  })

  it("refuses unwired channels even with full consent - no fabricated delivery", () => {
    for (const channel of ["push", "sms"] as const) {
      const decision = memberDeliveryDecision({
        channel,
        prefs: prefs({ timeZone: KARACHI }),
        now: UTC_NOON,
      })
      expect(decision).toEqual({ channel, allowed: false, reason: "channel_unwired" })
    }
  })

  it("B161: email consent is its own fail-closed gate, distinct from wiring", () => {
    // Preferences predating the field (no emailEnabled) never email.
    expect(memberDeliveryDecision({
      channel: "email",
      prefs: { ...prefs({ timeZone: KARACHI }), emailEnabled: undefined },
      now: UTC_NOON,
    })).toEqual({ channel: "email", allowed: false, reason: "consent_off" })
    // Explicit false refuses the same way.
    expect(memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ emailEnabled: false }),
      now: UTC_NOON,
    })).toEqual({ channel: "email", allowed: false, reason: "consent_off" })
    // Consent alone is STILL not enough - the channel must be wired server-side.
    expect(memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ emailEnabled: true }),
      now: UTC_NOON,
    })).toEqual({ channel: "email", allowed: false, reason: "channel_unwired" })
    // A deployment that genuinely wires email (B161 dispatch passes this only
    // when NOTIFICATION_EMAIL_READY + provider key are configured) may send.
    expect(memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ emailEnabled: true }),
      now: UTC_NOON,
      wiring: { email: true },
    })).toEqual({ channel: "email", allowed: true, reason: "ok" })
    // The wiring override cannot resurrect a channel the member refused.
    expect(memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ emailEnabled: false }),
      now: UTC_NOON,
      wiring: { email: true },
    })).toEqual({ channel: "email", allowed: false, reason: "consent_off" })
  })

  it("honors in-app consent", () => {
    const decision = memberDeliveryDecision({ channel: "in_app", prefs: prefs({ inAppEnabled: false }), now: UTC_NOON })
    expect(decision).toEqual({ channel: "in_app", allowed: false, reason: "consent_off" })
  })

  it("never applies quiet hours to the in-app inbox - it wakes nobody, so history is not withheld", () => {
    const decision = memberDeliveryDecision({
      channel: "in_app",
      prefs: prefs({ quietStartMinute: 13 * 60, quietEndMinute: 15 * 60, timeZone: "UTC" }),
      now: UTC_NOON, // 12:00 is outside anyway; the point is no suppression either way.
    })
    expect(decision).toEqual({ channel: "in_app", allowed: true, reason: "ok" })
  })

  it("suppresses an (unwired) interrupting channel inside the member's own quiet window", () => {
    const decision = memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ quietStartMinute: 16 * 60, quietEndMinute: 18 * 60, timeZone: KARACHI }),
      now: UTC_NOON, // 17:00 in Karachi - inside [16:00, 18:00).
    })
    expect(decision).toEqual({ channel: "email", allowed: false, reason: "quiet_hours" })
  })

  it("evaluates wrapping windows in the member's zone, not the server's", () => {
    const inside = memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ quietStartMinute: 22 * 60, quietEndMinute: 7 * 60, timeZone: KARACHI }),
      now: UTC_0130, // 06:30 in Karachi - inside the wrap window.
    })
    // Quiet hours are evaluated BEFORE wiring, so the member's own saved
    // window - not the platform's wiring gap - is the observable refusal.
    expect(inside).toEqual({ channel: "email", allowed: false, reason: "quiet_hours" })
  })

  it("reports unwired channels honestly once the quiet window is past", () => {
    const outside = memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ quietStartMinute: 22 * 60, quietEndMinute: 7 * 60, timeZone: KARACHI }),
      now: new Date("2026-10-17T02:30:00Z"), // 07:30 Karachi - outside the window.
    })
    expect(outside).toEqual({ channel: "email", allowed: false, reason: "channel_unwired" })
  })

  it("falls back to UTC minutes when the stored zone is unresolvable - quiet never fails open", () => {
    const decision = memberDeliveryDecision({
      channel: "email",
      prefs: prefs({ quietStartMinute: 10 * 60, quietEndMinute: 14 * 60, timeZone: "Mars/Olympus" }),
      now: UTC_NOON, // 12:00 UTC - inside the window under the UTC fallback.
    })
    expect(decision).toEqual({ channel: "email", allowed: false, reason: "quiet_hours" })
  })
})
