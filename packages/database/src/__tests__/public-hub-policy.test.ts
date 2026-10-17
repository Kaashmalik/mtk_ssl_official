import { describe, expect, it } from "vitest"
import {
  HUB_LISTED,
  HUB_UNLISTED,
  hubListingEligible,
  hubListingTransition,
} from "../lib/public-hub-policy"

const LISTED_AT = new Date("2026-10-17T00:00:00Z")

describe("PUB-02 hub listing policy (fail closed)", () => {
  it.each([
    ["listed with timestamp and active", { hubListingStatus: HUB_LISTED, hubListedAt: LISTED_AT, isActive: true }, true],
    ["listed but missing provenance timestamp", { hubListingStatus: HUB_LISTED, hubListedAt: null, isActive: true }, false],
    ["listed but deactivated league", { hubListingStatus: HUB_LISTED, hubListedAt: LISTED_AT, isActive: false }, false],
    ["listed but activation unknown", { hubListingStatus: HUB_LISTED, hubListedAt: LISTED_AT, isActive: null }, false],
    ["unlisted default", { hubListingStatus: HUB_UNLISTED, hubListedAt: null, isActive: true }, false],
    ["unknown status value", { hubListingStatus: "pending", hubListedAt: LISTED_AT, isActive: true }, false],
    ["missing status", { hubListedAt: LISTED_AT, isActive: true }, false],
  ])("%s → %p", (_name, row, expected) => {
    expect(hubListingEligible(row)).toBe(expected)
  })
  it.each([null, undefined])("a missing row (%p) is never eligible", row => {
    expect(hubListingEligible(row)).toBe(false)
  })

  it("treats an unlisted row with a stale timestamp as uneligible, not as a hidden listing", () => {
    expect(hubListingEligible({ hubListingStatus: HUB_UNLISTED, hubListedAt: LISTED_AT, isActive: true })).toBe(false)
  })

  it.each([
    ["unlisted → listed", HUB_UNLISTED, true, { changed: true, status: HUB_LISTED }],
    ["listed → unlisted", HUB_LISTED, false, { changed: true, status: HUB_UNLISTED }],
    ["listed → listed is a no-op", HUB_LISTED, true, { changed: false, status: HUB_LISTED }],
    ["unlisted → unlisted is a no-op", HUB_UNLISTED, false, { changed: false, status: HUB_UNLISTED }],
    ["unknown current treated as unlisted → listing changes", null, true, { changed: true, status: HUB_LISTED }],
  ])("%s", (_name, current, enable, expected) => {
    expect(hubListingTransition(current, enable)).toEqual(expected)
  })
})
