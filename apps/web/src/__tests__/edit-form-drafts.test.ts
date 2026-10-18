import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * UX-03 durable forms slice 3: the four EDIT forms carry the same durable
 * per-record drafts the six CREATE forms got in Batch 106. A client bundle
 * change that silently unwires a hook, banner, clear-on-success or the
 * discard-to-server-truth path would regress the journey without any test
 * noticing - these static guards catch that drift.
 */

const componentDir = fileURLToPath(new URL("../components/", import.meta.url))

const EDIT_FORMS: Record<string, string> = {
  "teams/edit-team-form.tsx": "Edit Team",
  "players/edit-player-form.tsx": "Edit Player",
  "matches/edit-match-form.tsx": "Edit Match",
  "tournaments/edit-tournament-form.tsx": "Edit Tournament",
}

const sources = Object.fromEntries(
  Object.keys(EDIT_FORMS).map((file) => [file, readFileSync(componentDir + file, "utf8")]),
)

describe("UX-03: every edit form keeps its durable per-record draft", () => {
  it.each(Object.keys(EDIT_FORMS))("wires the hook, per-record key and banner into %s", (file) => {
    const src = sources[file]
    // The draft key interpolates the record id: two records must never share
    // a draft.
    expect(src).toMatch(/useDurableFormDraft<Record<string, string>>\(`edit-[a-z]+:\$\{\w+\.id\}`, 1\)/)
    // Restoration is explicit and banner-visible, never a silent overwrite.
    expect(src).toContain("if (restoredDraft) {")
    expect(src).toContain("<DraftRestoreBanner restoredAt={restoredAt}")
    // The seeded state comes from server truth, so a restored draft only
    // overlays the member's edits.
    expect(src).toContain("useState(recordDraft)")
  })

  it.each(Object.keys(EDIT_FORMS))("clears the draft before navigation and discards to server truth in %s", (file) => {
    const src = sources[file]
    // Exactly two clear points: submit success and explicit discard.
    expect(src.split("clearDraft()").length - 1).toBe(2)
    const successClear = src.lastIndexOf("clearDraft()")
    const navigate = src.lastIndexOf("router.push(`")
    expect(navigate).toBeGreaterThan(successClear)
    // Discard restores the exact server-seeded values, never blanks.
    expect(src).toContain("setFormData(recordDraft)")
  })

  it("keeps rendering each form's own heading next to the inserted banner", () => {
    for (const [file, heading] of Object.entries(EDIT_FORMS)) {
      expect(sources[file]).toContain(heading)
    }
  })
})
