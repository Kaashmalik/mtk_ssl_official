import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * FAN-01 reports slice, static wiring guard. The report flow is honest only
 * if every layer keeps its contract: the identity gate alone decides whether
 * the fan affordance renders, the client surfaces every writer outcome,
 * the owner queue records provenance through the locked writer, and the
 * action tier stays a thin delegate with no database import.
 */

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")

function source(rel: string) {
  return readFileSync(join(WEB_SRC, rel), "utf8")
}

describe("FAN-01 reports slice wiring", () => {
  it("renders the fan affordance only behind an identity gate on the public match page", () => {
    const page = source("app/matches/[matchId]/page.tsx")
    // The control is conditional on a proven fan context - never rendered for
    // an anonymous visit, and never tied to whether the fan has reacted.
    expect(page).toContain("canReportFeed ? <ReactionFeedReport matchId={matchId} /> : null")
    // The flag can only be earned by a successful fan-context read...
    expect(page).toContain("canReportFeed = true")
    // ...and resets closed when that read fails.
    expect(page).toMatch(/catch \{[\s\S]*?myReactions = \[\][\s\S]*?\}/)
    // No assignment besides the closed-by-default declaration.
    expect((page.match(/(?<!let )canReportFeed = false/g) ?? []).length).toBe(0)
  })

  it("surfaces every writer outcome honestly in the client report control", () => {
    const control = source("components/shared/reaction-feed-report.tsx")
    expect(control).toContain('"use client"')
    expect(control).toContain("reportMatchReactionFeedAction")
    expect(control).toContain('result.action === "open"')
    expect(control).toContain('result.action === "already_open"')
    expect(control).toContain('"report_rate_limited"')
  })

  it("keeps fixed platform-chosen reasons; no free text leaves the client", () => {
    const control = source("components/shared/reaction-feed-report.tsx")
    expect(control).toContain("REACTION_REPORT_REASONS")
    expect(control).toContain("REACTION_REPORT_REASON_LABELS")
    expect(/<textarea|<Input|<input/i.test(control)).toBe(false)
  })

  it("wires the owner decision queue through the locked writer only", () => {
    const card = source("components/matches/reaction-moderation-card.tsx")
    expect(card).toContain("decideReactionReportAction")
    expect(card).toContain('decision === "actioned" ? "Report marked actioned" : "Report dismissed"')
    // A decided report always leaves the queue; replays are surfaced, not retried.
    expect(card).toContain("prev.filter")
    const dashboard = source("app/dashboard/matches/[id]/page.tsx")
    expect(dashboard).toContain("readOpenReactionReports")
    expect(dashboard).toMatch(/try \{[\s\S]*?readOpenReactionReports[\s\S]*?\} catch \{[\s\S]*?openReactionReports = \[\]/)
  })

  it("keeps the action tier a thin delegate with no database import", () => {
    const actions = source("app/actions/fan-reaction-reports.ts")
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).not.toMatch(/from "@mtk\/database"|from "drizzle-orm"/)
    for (const delegate of [
      "reportMatchReactionFeedAction",
      "decideReactionReportAction",
    ]) {
      expect(actions).toContain(delegate)
    }
  })

  it("enforces blocks inside the engagement writers, before any other gate", () => {
    for (const writerRel of ["lib/fan-reactions.ts", "lib/fan-report-records.ts"]) {
      const writer = source(writerRel)
      expect(writer).toContain("readActiveFanBlockExists")
      // The gate runs on the fan context alone (tenant + actor), before the
      // target read: order enforced by the gate comment numbering "before any".
      const gateAt = writer.indexOf("readActiveFanBlockExists")
      const targetAt = writer.indexOf("readReactionTarget")
      if (targetAt !== -1) expect(gateAt).toBeLessThan(targetAt)
    }
  })

  it("keeps the block surface league-scoped, replay-safe and lift-provenance-honest", () => {
    const blockWriter = source("lib/fan-block-records.ts")
    // League scope: tenant pinned on every path (insert payload + both reads).
    expect(blockWriter).toContain("tenantId,")
    expect(blockWriter).toContain('eq(fanBlocks.tenantId, tenantId)')
    // Replay safety + provenance: partial-unique absorb, lift under lock.
    expect(blockWriter).toContain("onConflictDoNothing")
    expect(blockWriter).toContain('for("update")')
    expect(blockWriter).toContain('"already_blocked"')
    expect(blockWriter).toContain('"already_lifted"')
    // Queued actions stay thin delegates with no database import.
    const actions = source("app/actions/fan-interaction-blocks.ts")
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).not.toMatch(/from "@mtk\/database"|from "drizzle-orm"/)
  })

  it("gives the loop one reviewable home: the league-wide settings queue", () => {
    const page = source("app/dashboard/settings/fan-interactions/page.tsx")
    // Owner-gated with the moderation authority, not settings:manage, and
    // both queues fail closed to empty - a read failure is never a page
    // failure.
    expect(page).toMatch(/await requireActiveLeagueContext\("match:update"\)/)
    expect(page).toMatch(/try \{[\s\S]*?readLeagueOpenReports[\s\S]*?\} catch/)
    expect(page).toMatch(/try \{[\s\S]*?readActiveFanBlocks[\s\S]*?\} catch/)
    // Visibility only: no direct db import on the page - every mutation
    // flows through the writer actions.
    expect(page).not.toMatch(/from "@mtk\/database"|from "drizzle-orm"/)
    // Discoverable from the settings home (the Quick Links pattern).
    const settingsHome = source("app/dashboard/settings/page.tsx")
    expect(settingsHome).toContain('href="/dashboard/settings/fan-interactions"')
    // The manager interacts ONLY through the same locked-writer actions the
    // per-match card uses - no second, parallel decision path.
    const manager = source("components/settings/fan-interactions-manager.tsx")
    expect(manager).toContain("decideReactionReportAction")
    expect(manager).toContain("liftFanBlockAction")
    expect(manager).not.toMatch(/from "@mtk\/database"|from "drizzle-orm"/)
    expect(manager).toContain("`/dashboard/matches/${report.matchId}`")
  })
})
