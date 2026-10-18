import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * COMP-07 (Batch 153): page-wiring pins. The competition controls are
 * owner-only on the match detail page (the same gate shape as FAN-01
 * moderation), the card lives in components/matches, and the action
 * module revalidates the dashboard. These are source-shape pins: the
 * journey behavior lives in the writer tests, and the pure state machine
 * lives in the policy tests.
 */
const root = process.cwd()

const page = readFileSync(join(root, "src/app/dashboard/matches/[id]/page.tsx"), "utf8")
const card = readFileSync(join(root, "src/components/matches/match-control-card.tsx"), "utf8")
const actions = readFileSync(join(root, "src/app/actions/competition-control.ts"), "utf8")

describe("COMP-07 (Batch 153): match control wiring", () => {
  it("mounts the control card owner-only, after the readiness surface", () => {
    expect(page).toContain('viewerIsLeagueOwner && (')
    expect(page).toContain("<MatchControlCard")
    const ownerGate = page.indexOf("viewerIsLeagueOwner && (")
    const cardMount = page.indexOf("<MatchControlCard")
    expect(cardMount).toBeGreaterThan(ownerGate)
  })

  it("hands the card only the match id and current status - never authority", () => {
    expect(card).toContain('matchId: string; matchStatus: string | null')
    expect(card).toContain("router.refresh()")
  })

  it("requires a reason for forfeit and postpone, and disables empty submits", () => {
    expect(card).toMatch(/disabled=\{pending \|\| !forfeitReason\.trim\(\)\}/)
    expect(card).toMatch(/disabled=\{pending \|\| !postponeReason\.trim\(\)\}/)
    expect(card).toMatch(/OPEN_FOR_CONTROL/)
    expect(card).toMatch(/OPEN_FOR_RESCHEDULE/)
  })

  it("routes moves through the zod-bounded server actions that revalidate the dashboard", () => {
    expect(card).toContain('from "@/app/actions/competition-control"')
    expect(actions).toContain('"use server"')
    expect(actions).toContain('revalidatePath("/dashboard/matches")')
    expect(actions).toMatch(/\.strict\(\)/)
  })

  it("tells the truth about closed matches - no controls on recorded results", () => {
    expect(card).toContain("Recorded results and closed fixtures have no")
    expect(card).toContain("correction")
  })
})
