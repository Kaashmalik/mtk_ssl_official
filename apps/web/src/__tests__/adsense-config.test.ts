import { afterEach, describe, expect, it } from "vitest"
import { adsAllowedOnPath, adsenseArticleSlot, adsenseClient, adsensePublisherId } from "@/lib/adsense"
import { GET as adsTxt } from "@/app/ads.txt/route"

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe("AdSense configuration", () => {
  it("is fully off when no client id is configured", async () => {
    delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT
    expect(adsenseClient()).toBeNull()
    expect(adsensePublisherId()).toBeNull()
    const res = adsTxt()
    expect(res.status).toBe(404)
  })

  it("rejects malformed client ids instead of emitting them", () => {
    for (const bad of ["pub-1234567890123456", "ca-pub-123", "ca-pub-12345678901234567", "ca-pub-1234567890123456<script>"]) {
      process.env.NEXT_PUBLIC_ADSENSE_CLIENT = bad
      expect(adsenseClient(), bad).toBeNull()
    }
  })

  it("derives ads.txt from the same client id as the script", async () => {
    process.env.NEXT_PUBLIC_ADSENSE_CLIENT = " ca-pub-1234567890123456 \n"
    expect(adsenseClient()).toBe("ca-pub-1234567890123456")
    const res = adsTxt()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/plain")
    expect(await res.text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n")
  })

  it("validates the article slot id", () => {
    process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE = "1234567890"
    expect(adsenseArticleSlot()).toBe("1234567890")
    process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE = "abc"
    expect(adsenseArticleSlot()).toBeNull()
  })

  it("allows ads on public reading pages", () => {
    for (const path of ["/", "/guides", "/guides/net-run-rate-explained", "/hub", "/leaderboards", "/matches/abc", "/tournaments/abc"]) {
      expect(adsAllowedOnPath(path), path).toBe(true)
    }
  })

  it("never allows ads in the product, the scorer view or auth flows", () => {
    for (const path of ["/dashboard", "/dashboard/matches", "/settings", "/broadcast/x", "/sign-in", "/sign-up/verify", "/accept-invite", "/matches/abc/scoring", "/offline"]) {
      expect(adsAllowedOnPath(path), path).toBe(false)
    }
  })
})
