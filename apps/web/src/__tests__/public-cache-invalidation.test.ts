import { beforeEach, describe, expect, it, vi } from "vitest"
import { updatePublicCareerConsent } from "@/app/actions/career"

/**
 * PUB-06 cache/withdrawal invalidation (career consent slice).
 *
 * Toggling public career consent changes exactly two public surfaces: the
 * leaderboards (consent gates inclusion) and the user's public career hub.
 * BOTH directions must revalidate the hub for the EXACT account - a visited
 * hub must not keep serving the pre-toggle copy, and a withdrawal must not
 * leave a cached grant readable.
 */

const mocks = vi.hoisted(() => ({
  setConsent: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("@/lib/career-records", () => ({ setPublicCareerConsent: mocks.setConsent }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))

const USER = "da7c0ab5-0810-482a-a92c-886a87754b20"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("PUB-06: career consent withdrawal invalidates public surfaces", () => {
  it("revalidates the leaderboards AND the exact public career hub on grant", async () => {
    mocks.setConsent.mockResolvedValue({ userId: USER, granted: true, consentedAt: new Date("2026-10-18T00:00:00Z") })

    const result = await updatePublicCareerConsent(true)

    expect(mocks.setConsent).toHaveBeenCalledWith(true)
    expect(mocks.revalidate).toHaveBeenCalledWith("/leaderboards")
    expect(mocks.revalidate).toHaveBeenCalledWith(`/hub/players/${USER}`)
    expect(result).toMatchObject({ success: true, granted: true })
  })

  it("revalidates the same public surfaces on withdrawal - a cached grant cannot survive", async () => {
    mocks.setConsent.mockResolvedValue({ userId: USER, granted: false, consentedAt: null })

    const result = await updatePublicCareerConsent(false)

    expect(mocks.setConsent).toHaveBeenCalledWith(false)
    expect(mocks.revalidate).toHaveBeenCalledWith("/leaderboards")
    expect(mocks.revalidate).toHaveBeenCalledWith(`/hub/players/${USER}`)
    expect(result).toMatchObject({ success: true, granted: false, consentedAt: null })
  })

  it("rejects a non-boolean payload before any consent write or revalidation", async () => {
    await expect(updatePublicCareerConsent("yes")).rejects.toThrow()
    expect(mocks.setConsent).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
