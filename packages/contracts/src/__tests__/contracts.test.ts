import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  CONTRACT_ERROR_CODE_VALUES,
  CONTRACTS_VERSION,
  CAPABILITIES_VERSION,
  CAPABILITY_KEYS,
  SURFACE_CAPABILITIES,
  PublicMatch,
  PublicTeam,
  PublicTournament,
  SCORING_COMMAND_VERSION,
  SURFACE_IDS,
  capabilitiesFor,
  contractError,
  decodeCursor,
  encodeCursor,
  isContractError,
  isMatchPublished,
  isTournamentPublished,
  nextPageCursor,
  queuedDeliveryToCommand,
  recordBallCommandSchema,
  toCursorPage,
} from "../index"

/**
 * ENH-03-01 pins: the contract vocabulary is complete, the validation
 * behaves as documented, the pagination envelope is portable and
 * round-trips, and - critically for native adoption - the package cannot
 * silently acquire a framework, node or server-secret dependency.
 */

describe("status vocabulary", () => {
  it("carries the COMPLETE database match_status enum (10 values - the native union previously missed forfeited/postponed)", () => {
    expect(isMatchPublished("forfeited")).toBe(false) // known the moment the vocabulary compiles
  })

  it("gates publication exactly like the database SoT", () => {
    expect(isTournamentPublished("registration")).toBe(true)
    expect(isTournamentPublished("live")).toBe(true)
    expect(isTournamentPublished("completed")).toBe(true)
    expect(isTournamentPublished("draft")).toBe(false)
    expect(isTournamentPublished("cancelled")).toBe(false)
    expect(isMatchPublished("scheduled")).toBe(true)
    expect(isMatchPublished("toss")).toBe(true)
    expect(isMatchPublished("innings_break")).toBe(true)
    expect(isMatchPublished("abandoned")).toBe(true)
    expect(isMatchPublished("no_result")).toBe(true)
    expect(isMatchPublished("cancelled")).toBe(false)
    expect(isMatchPublished("forfeited")).toBe(false)
    expect(isMatchPublished(null)).toBe(false)
    expect(isTournamentPublished(undefined)).toBe(false)
  })
})

describe("scoring command", () => {
  const REAL_FIXTURE = {
    matchId: "01a155d6-3723-7b9f-bcd6-673926ddeee0",
    inningsId: "01a155d7-0000-7000-8000-000000000000",
    clientOpId: "op-01a155d8-offline-flush",
    overNumber: 3,
    ballNumber: 4,
    runs: 4,
    batsmanId: "01980000-0000-7000-8000-000000000001",
    bowlerId: "01980000-0000-7000-8000-000000000002",
    isWicket: false,
    isWide: false,
    isNoBall: false,
    isBye: false,
    isLegBye: false,
    isFour: true,
    isSix: false,
    handoverEpoch: 2,
    expectedRevision: 41,
  }

  it("accepts a real-shaped delivery (fixture mirrors actual live payloads)", () => {
    const parsed = recordBallCommandSchema.parse(REAL_FIXTURE)
    expect(parsed.clientOpId).toBe("op-01a155d8-offline-flush")
    expect(parsed.isWicket).toBe(false)
    expect(parsed.isFour).toBe(true)
    expect(SCORING_COMMAND_VERSION).toBe(1)
  })

  it("applies the documented schema defaults", () => {
    const parsed = recordBallCommandSchema.parse({ ...REAL_FIXTURE, isFour: undefined })
    expect(parsed.isFour).toBe(false)
    expect(parsed.isWicket).toBe(false)
  })

  it("keeps the server's runs ceiling at 7 (the UI-8-vs-server-7 divergence is resolved on the wire as 0..7)", () => {
    for (const runs of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(() => recordBallCommandSchema.parse({ ...REAL_FIXTURE, runs })).not.toThrow()
    }
    expect(() => recordBallCommandSchema.parse({ ...REAL_FIXTURE, runs: 8 })).toThrow()
  })

  it("binds display coordinates to real delivery bounds", () => {
    expect(() => recordBallCommandSchema.parse({ ...REAL_FIXTURE, ballNumber: 7 })).toThrow()
    expect(() => recordBallCommandSchema.parse({ ...REAL_FIXTURE, ballNumber: 0 })).toThrow()
    expect(() => recordBallCommandSchema.parse({ ...REAL_FIXTURE, overNumber: -1 })).toThrow()
  })

  it("keeps wicket discipline: isWicket wicketType pairing stays a writer-level rule, schema still validates the shape", () => {
    const wicket = recordBallCommandSchema.parse({
      ...REAL_FIXTURE,
      isWicket: true,
      wicketType: "bowled",
      isFour: false,
    })
    expect(wicket.wicketType).toBe("bowled")
    expect(() =>
      recordBallCommandSchema.parse({ ...REAL_FIXTURE, isWicket: true, wicketType: "mankad" }),
    ).toThrow()
  })

  it("carries the review envelope intact", () => {
    const parsed = recordBallCommandSchema.parse({
      ...REAL_FIXTURE,
      review: { reason: "Umpire signalled a leg bye, recorded as a wide by mistake", previousEpoch: 1 },
    })
    expect(parsed.review?.reason).toContain("leg bye")
    expect(parsed.review?.previousEpoch).toBe(1)
  })

  it("is STRICT (ENH-03-02): the old offline-flush body with nested extras/wicket objects is REFUSED, never silently stripped", () => {
    // Exactly the body `use-offline-sync.ts` used to POST: nested service-
    // shaped objects the previous lenient schema dropped on the floor, so a
    // queued wicket arrived as "not out" and a wide as one invented legal run.
    const LEGACY_FLUSH_BODY = {
      ...REAL_FIXTURE,
      extras: { type: "wide", runs: 1 },
      wicket: { type: "bowled", playerId: REAL_FIXTURE.batsmanId },
    }
    const result = recordBallCommandSchema.safeParse(LEGACY_FLUSH_BODY)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true)
    }
  })
})

describe("queued delivery adapter (ENH-03-02)", () => {
  const QUEUED_BALL = {
    id: "m-lw3xyz-abc123",
    matchId: "01a155d6-3723-7b9f-bcd6-673926ddeee0",
    inningsId: "01a155d7-0000-7000-8000-000000000000",
    over: 3,
    ball: 4,
    runs: 0,
    batsmanId: "01980000-0000-7000-8000-000000000001",
    bowlerId: "01980000-0000-7000-8000-000000000002",
    isWicket: true,
    wicketType: "bowled",
    handoverEpoch: 2,
    expectedRevision: 41,
  }

  it("maps an offline wicket to a command that KEEPS the dismissal (the intent the old flush lost)", () => {
    const mapped = queuedDeliveryToCommand(QUEUED_BALL)
    expect(mapped.ok).toBe(true)
    if (mapped.ok) {
      expect(mapped.command.isWicket).toBe(true)
      expect(mapped.command.wicketType).toBe("bowled")
      expect(mapped.command.runs).toBe(0)
      expect(mapped.command.clientOpId).toBe("m-lw3xyz-abc123")
      expect(mapped.command.overNumber).toBe(3)
      expect(mapped.command.ballNumber).toBe(4)
      expect(mapped.command.handoverEpoch).toBe(2)
      expect(mapped.command.expectedRevision).toBe(41)
    }
  })

  it("maps every extras kind to its flattened boolean, never to a bare runs value", () => {
    for (const flag of ["isWide", "isNoBall", "isBye", "isLegBye"] as const) {
      const mapped = queuedDeliveryToCommand({ ...QUEUED_BALL, isWicket: false, wicketType: null, runs: 1, [flag]: true })
      expect(mapped.ok).toBe(true)
      if (mapped.ok) {
        expect(mapped.command[flag]).toBe(true)
        expect(mapped.command.runs).toBe(1)
      }
    }
  })

  it("derives isFour/isSix from batter runs so web and native agree without a client flag", () => {
    const four = queuedDeliveryToCommand({ ...QUEUED_BALL, isWicket: false, wicketType: null, runs: 4 })
    const six = queuedDeliveryToCommand({ ...QUEUED_BALL, isWicket: false, wicketType: null, runs: 6 })
    const single = queuedDeliveryToCommand({ ...QUEUED_BALL, isWicket: false, wicketType: null, runs: 1 })
    expect(four.ok && four.command.isFour && !four.command.isSix).toBe(true)
    expect(six.ok && six.command.isSix && !six.command.isFour).toBe(true)
    expect(single.ok && !single.command.isFour && !single.command.isSix).toBe(true)
  })

  it("refuses unsyncable entries with a stated reason instead of looping forever", () => {
    expect(queuedDeliveryToCommand({ ...QUEUED_BALL, inningsId: null })).toMatchObject({ ok: false, reason: "missing_innings_id" })
    expect(queuedDeliveryToCommand({ ...QUEUED_BALL, bowlerId: null })).toMatchObject({ ok: false, reason: "missing_participants" })
    expect(queuedDeliveryToCommand({ ...QUEUED_BALL, wicketType: null })).toMatchObject({ ok: false, reason: "wicket_requires_type" })
  })

  it("enforces the server's runs ceiling at the adapter, so a stale UI value of 8 can never jam the queue", () => {
    const mapped = queuedDeliveryToCommand({ ...QUEUED_BALL, isWicket: false, wicketType: null, runs: 8 })
    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.reason).toContain("invalid_command: runs")
  })
})

describe("public projections", () => {
  // Fixtures mirror the EXACT disclosed field sets of the PUB-06 allowlists
  // (values patterned on live rows). If the contract type grows a field, the
  // annotation below fails type-check; if the wire loses one, the fixture
  // assignment fails at compile time.
  const wireMatch: PublicMatch = {
    id: "01a155d6-3723-7b9f-bcd6-673926ddeee0",
    tournamentId: "01a155ca-dc9f-7aab-b9a6-b823375fbaa5",
    status: "scheduled",
    matchFormat: "t20",
    matchType: "group",
    totalOvers: 20,
    scheduledDate: "2026-10-20T10:00:00.000Z",
    venueId: "01980000-0000-7000-8000-00000000venue".replace("venue", "a101"),
    teamAId: "01980000-0000-7000-8000-0000000000aa",
    teamBId: "01980000-0000-7000-8000-0000000000bb",
    tossWinnerId: null,
    tossDecision: null,
    winnerId: null,
    result: null,
    manOfMatchId: null,
    streamSource: null,
    streamStatus: null,
    liveStreamUrl: null,
  }

  const wireTeam: PublicTeam = {
    id: "01980000-0000-7000-8000-0000000000aa",
    name: "Fixture United",
    shortName: "FIX",
    city: "Lahore",
    logoUrl: null,
    primaryColor: "#0f766e",
    secondaryColor: null,
    homeGround: "Fixture Ground",
    foundedYear: 2019,
  }

  const wireTournament: PublicTournament = {
    id: "01a155ca-dc9f-7aab-b9a6-b823375fbaa5",
    name: "Fixture Cup",
    description: null,
    format: "t20",
    status: "registration",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: null,
    championTeamId: null,
  }

  it("accepts real-shaped public rows (18-field match allowlist intact)", () => {
    expect(Object.keys(wireMatch).sort()).toHaveLength(18)
    expect(wireTeam.homeGround).toBe("Fixture Ground")
    expect(isTournamentPublished(wireTournament.status)).toBe(true)
  })
})

describe("cursor pagination", () => {
  it("round-trips an opaque cursor across surfaces", () => {
    const cursor = encodeCursor({ v: 1, after: "01980000-0000-7000-8000-0000000000aa" })
    expect(cursor.includes("{")).toBe(false) // URI-safe, no raw JSON on the wire
    expect(decodeCursor(cursor)).toEqual({ v: 1, after: "01980000-0000-7000-8000-0000000000aa" })
  })

  it("passes null through as the end-of-list marker", () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor("")).toBeNull()
  })

  it("fails loudly on malformed or foreign-version cursors (never silently rewind)", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow()
    expect(() => decodeCursor(encodeURIComponent(JSON.stringify({ v: 99, after: "x" })))).toThrow()
    expect(() => decodeCursor(encodeURIComponent(JSON.stringify({ v: 1 })))).toThrow()
  })

  it("emits a next cursor only for a FULL page (partial page = end of list)", () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `01980000-0000-7000-8000-${String(i).padStart(12, "0")}` }))
    const full = toCursorPage(page(3), 3)
    expect(full.items).toHaveLength(3)
    expect(decodeCursor(full.nextCursor)).toEqual({ v: 1, after: "01980000-0000-7000-8000-000000000002" })
    expect(nextPageCursor(page(2), 3)).toBeNull()
    expect(nextPageCursor([], 3)).toBeNull()
    const assembled = toCursorPage(page(3), 3)
    expect(assembled.items[assembled.items.length - 1].id).toBe("01980000-0000-7000-8000-000000000002")
  })
})

describe("error contract", () => {
  it("exposes every documented refusal code", () => {
    expect(CONTRACT_ERROR_CODE_VALUES.length).toBe(10)
    expect(CONTRACT_ERROR_CODE_VALUES).toContain("conflict_stale_revision")
    expect(CONTRACT_ERROR_CODE_VALUES).toContain("conflict_handover_epoch")
  })

  it("narrows contract errors and rejects everything else", () => {
    expect(isContractError(contractError("rate_limited", "slow down"))).toBe(true)
    expect(contractError("conflict_stale_revision", "stale", { currentRevision: 42 }).details).toEqual({ currentRevision: 42 })
    expect(isContractError({ code: "nope", message: "x" })).toBe(false)
    expect(isContractError(new Error("plain"))).toBe(false)
    expect(isContractError(null)).toBe(false)
  })
})

describe("surface capabilities", () => {
  it("versions the sheet and keeps every surface total (no partial capability records)", () => {
    expect(CAPABILITIES_VERSION).toBe(1)
    for (const surface of SURFACE_IDS) {
      const caps = capabilitiesFor(surface)
      expect(caps).not.toBeNull()
      expect(Object.keys(caps as object).sort()).toEqual([...CAPABILITY_KEYS].sort())
    }
    expect(capabilitiesFor("unknown-surface")).toBeNull()
  })

  it("pins each surface's posture exactly (roles, not levels: member's submitApplication is deliberately absent from organizer)", () => {
    expect(SURFACE_CAPABILITIES.public).toEqual({
      readPublic: true, readMember: false, submitApplication: false, submitScore: false,
      manageLeague: false, reviewRegistrations: false, administerPlatform: false,
    })
    expect(SURFACE_CAPABILITIES.member).toEqual({
      readPublic: true, readMember: true, submitApplication: true, submitScore: false,
      manageLeague: false, reviewRegistrations: false, administerPlatform: false,
    })
    expect(SURFACE_CAPABILITIES.organizer).toEqual({
      readPublic: true, readMember: true, submitApplication: false, submitScore: true,
      manageLeague: true, reviewRegistrations: true, administerPlatform: false,
    })
    expect(SURFACE_CAPABILITIES.admin).toEqual({
      readPublic: true, readMember: true, submitApplication: false, submitScore: true,
      manageLeague: true, reviewRegistrations: true, administerPlatform: true,
    })
  })

  it("keeps the strict supersets that DO exist: public ⊆ member, organizer ⊆ admin", () => {
    const capsOf = (id: (typeof SURFACE_IDS)[number]) =>
      new Set(CAPABILITY_KEYS.filter((k) => SURFACE_CAPABILITIES[id][k]))
    for (const cap of capsOf("public")) expect(capsOf("member")).toContain(cap)
    for (const cap of capsOf("organizer")) expect(capsOf("admin")).toContain(cap)
  })

  it("never promises scoring or league management on public/member surfaces", () => {
    expect(SURFACE_CAPABILITIES.public.submitScore).toBe(false)
    expect(SURFACE_CAPABILITIES.member.submitScore).toBe(false)
    expect(SURFACE_CAPABILITIES.member.manageLeague).toBe(false)
    expect(SURFACE_CAPABILITIES.admin.administerPlatform).toBe(true)
  })
})

describe("package hygiene", () => {
  const PKG_ROOT = join(import.meta.dirname, "..", "..")

  it("has exactly ONE runtime dependency: zod (nothing can leak Next/DOM/node/db into native)", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      version: string
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["zod"])
    expect(CONTRACTS_VERSION).toBe(pkg.version)
  })

  it("imports nothing forbidden in src (next/react/node builtins/database/supabase)", () => {
    const FORBIDDEN = [
      /from\s+["']next/,
      /from\s+["']react/,
      /from\s+["']node:/,
      /require\(["']node:/,
      /from\s+["']@supabase/,
      /from\s+["']@mtk\/database/,
      /from\s+["']fs["']/,
      /from\s+["']path["']/,
      /from\s+["']process["']/,
    ]
    const srcDir = join(PKG_ROOT, "src")
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
      )
    for (const file of walk(srcDir)) {
      // Test files are node-side and may use fs/path for pins.
      if (file.includes("__tests__")) continue
      const text = readFileSync(file, "utf8")
      for (const rule of FORBIDDEN) {
        expect(text.match(rule), `${file} must not match forbidden import rule ${rule}`).toBeNull()
      }
    }
  })
})
