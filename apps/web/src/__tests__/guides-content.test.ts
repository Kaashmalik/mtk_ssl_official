import { describe, expect, it } from "vitest"
import { GUIDES, getGuide } from "@/content/guides"
import { headingId, proseWordCount } from "@/components/public/prose"

/**
 * The guides are the site's main readable content (search and AdSense
 * "valuable content" review). These pins keep every article substantial,
 * well-formed for search snippets, and correctly cross-linked.
 */
describe("public guides content", () => {
  it("has unique, URL-safe slugs", () => {
    const slugs = GUIDES.map((guide) => guide.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it("gives every guide a search-snippet-sized description and a title", () => {
    for (const guide of GUIDES) {
      expect(guide.title.length, guide.slug).toBeLessThanOrEqual(90)
      expect(guide.description.length, guide.slug).toBeGreaterThanOrEqual(100)
      expect(guide.description.length, guide.slug).toBeLessThanOrEqual(165)
    }
  })

  it("keeps every article substantial (no thin pages)", () => {
    for (const guide of GUIDES) {
      expect(proseWordCount(guide.body), guide.slug).toBeGreaterThanOrEqual(450)
    }
  })

  it("has unique heading anchors inside each article", () => {
    for (const guide of GUIDES) {
      const ids = guide.body.flatMap((block) => (block.type === "h2" ? [headingId(block)] : []))
      expect(new Set(ids).size, guide.slug).toBe(ids.length)
      expect(ids.length, guide.slug).toBeGreaterThanOrEqual(3)
    }
  })

  it("only links to guides and related guides that exist", () => {
    for (const guide of GUIDES) {
      for (const slug of guide.related) expect(getGuide(slug), `${guide.slug} -> ${slug}`).toBeDefined()
      const text = JSON.stringify(guide.body)
      for (const [, slug] of text.matchAll(/\]\(\/guides\/([a-z0-9-]+)\)/g)) {
        expect(getGuide(slug), `${guide.slug} links to missing /guides/${slug}`).toBeDefined()
      }
    }
  })

  it("uses ISO dates that are not in the future relative to each other", () => {
    for (const guide of GUIDES) {
      expect(guide.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.updatedAt >= guide.publishedAt, guide.slug).toBe(true)
    }
  })
})
