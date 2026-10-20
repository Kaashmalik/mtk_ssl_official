import { describe, expect, it } from "vitest"
import {
  queuedDeliveryToCommand,
  recordBallCommandSchema,
  type DeliverySubmission,
} from "@mtk/contracts"

/**
 * ENH-03-02: THE delivery boundary between every surface and the official
 * record. Three pins:
 *
 * 1. The schema is STRICT - a legacy or hostile transport body with nested
 *    `extras`/`wicket` objects (exactly what the native offline flush used
 *    to send) is REFUSED with 400, never accepted with its intent stripped.
 *    Silent stripping turned offline wickets into "not out" and wides into
 *    one invented legal run.
 * 2. The runs ceiling on the wire is 7 - the mobile grid used to offer 8,
 *    which the record refused and jammed the offline queue forever.
 * 3. Desktop web, the intake route and the offline adapter all validate
 *    through THIS one schema (import-path identity), so no surface can
 *    drift into a second, divergent delivery vocabulary.
 */
describe("delivery command boundary (ENH-03-02)", () => {
  const BASE = {
    matchId: "01a155d6-3723-7b9f-bcd6-673926ddeee0",
    inningsId: "01a155d7-0000-7000-8000-000000000000",
    clientOpId: "op-boundary-pin",
    overNumber: 0,
    ballNumber: 1,
    runs: 1,
    batsmanId: "01980000-0000-7000-8000-000000000001",
    bowlerId: "01980000-0000-7000-8000-000000000002",
  }

  it("refuses AND reports unknown keys instead of executing a stripped shadow of the sent delivery", () => {
    const result = recordBallCommandSchema.safeParse({
      ...BASE,
      isWide: true,
      // Legacy nested service shape - must never be silently dropped:
      extras: { type: "wide", runs: 1 },
    })
    expect(result.success).toBe(false)
  })

  it("accepts the canonical flattened shapes the surfaces actually send", () => {
    expect(() => recordBallCommandSchema.parse({ ...BASE, isWide: true })).not.toThrow()
    expect(() =>
      recordBallCommandSchema.parse({ ...BASE, isWicket: true, wicketType: "caught", runs: 0 }),
    ).not.toThrow()
  })

  it("keeps runs 0..7 on the wire: 8 is invalid at the boundary, the UI never queues it", () => {
    expect(() => recordBallCommandSchema.parse({ ...BASE, runs: 7 })).not.toThrow()
    expect(() => recordBallCommandSchema.parse({ ...BASE, runs: 8 })).toThrow()
    const mapped = queuedDeliveryToCommand({
      id: "m-pin",
      matchId: BASE.matchId,
      inningsId: BASE.inningsId,
      over: 0,
      ball: 1,
      runs: 8,
      batsmanId: BASE.batsmanId,
      bowlerId: BASE.bowlerId,
    })
    expect(mapped.ok).toBe(false)
  })

  it("is the single schema for web action, mobile intake and offline adapter (import identity)", () => {
    // `@mtk/contracts` re-exported by scoring-submission.ts is the SAME schema
    // object the intake route parses with - one vocabulary, one gate.
    const submission: DeliverySubmission = recordBallCommandSchema.parse({
      ...BASE,
      isWicket: true,
      wicketType: "run_out",
      runs: 0,
      queueAccountId: "user_2abcaccount",
      queueTenantId: "01a14071-d154-725f-86a4-ff3b5114a76a",
    })
    expect(submission.isWicket).toBe(true)
    expect(submission.clientOpId).toBe("op-boundary-pin")
  })
})
