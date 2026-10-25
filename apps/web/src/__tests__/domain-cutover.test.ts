import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Batch 149 (owner-domain cutover): the platform is LIVE on
 * https://www.cricketleague.tech (owner-confirmed; the data-side cutover is
 * registered in supabase/MIGRATION_STATUS.md — domain_cutover_cricketleague).
 * The code still surfaced the retired `ssl.mtkcodex.site` in five places a
 * member or organizer can SEE, and the mobile app still deep-linked only to
 * the dead host. Honesty rules for this batch:
 *
 *  - the WEB SEO layer (metadataBase, canonicals, sitemap, robots, JSON-LD)
 *    was already env-driven (Batches 112/113/117) — nothing hardcoded to
 *    change there; the live cut happens via the WEB_APP_URL env (documented).
 *  - EMAIL sending-domain fallbacks deliberately keep the currently-verified
 *    Resend domain until the owner verifies cricketleague.tech in Resend —
 *    switching the fallback blindly would silently break invitations and
 *    OTPs. Made env-coverable + documented instead.
 *  - the per-tenant SPF/DMARC RECORD BUILDERS become env-driven (default
 *    preserves today's exact records) so the mail cutover is config, not code.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "../../../..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const OLD_HOST = "ssl.mtkcodex.site"
const NEW_HOST = "cricketleague.tech"

describe("organizer-facing league URLs follow the host they are on (Batch 149)", () => {
  it.each([
    ["apps/web/src/components/league-setup-form.tsx"],
    ["apps/web/src/components/league-application-form.tsx"],
  ])("%s derives the public-league apex from the running host, never a hardcoded dead domain", (file) => {
    const source = read(file)
    // The badge showed `slug.ssl.mtkcodex.site` — wrong on the new apex and
    // wrong on every future custom-domain apex.
    expect(source).not.toContain(OLD_HOST)
    expect(source).toContain("window.location.host")
  })
})

describe("the mobile app opens the live domain (Batch 149)", () => {
  it("WatchLiveButton defaults to the new web app", () => {
    const button = read("apps/mobile/src/components/WatchLiveButton.tsx")
    expect(button).toContain(NEW_HOST)
    expect(button).not.toContain(OLD_HOST)
  })

  it("deep links parse BOTH hosts — links already shared to the old host keep working in-app", () => {
    const deep = read("apps/mobile/src/lib/deep-linking.ts")
    expect(deep).toContain(NEW_HOST)
    expect(deep).toContain(OLD_HOST) // legacy shared links must not break
  })

  it("app.json intent filters advertise the new host (and stop advertising the dead one)", () => {
    const appJson = read("apps/mobile/app.json")
    expect(appJson).toContain(NEW_HOST)
    expect(appJson).not.toContain(OLD_HOST)
  })
})

describe("per-tenant email verification records are platform-mail-env-driven (Batch 149)", () => {
  it("domain-verification builds SPF/DMARC from the configured platform mail domain", () => {
    const source = read("apps/web/src/lib/domain-verification.ts")
    expect(source).toContain("platformMailDomain")
    expect(source).toContain(NEW_HOST)
    // The DEFAULT must preserve today's exact generated records until the
    // mail cutover is actually performed — behavior-preserving refactor.
    expect(source).toContain(OLD_HOST)
  })
})

describe("deployment documents tell the new-domain truth (Batch 149)", () => {
  it(".env.example carries the live domain and the mail-cutover warning", () => {
    const env = read(".env.example")
    expect(env).toContain(`WEB_APP_URL=https://www.${NEW_HOST}`)
    expect(env).toContain(OLD_HOST) // mail fallback documented, not silently flipped
  })

  it("live.md records the cutover and the remaining provider checklist", () => {
    const live = read("live.md")
    expect(live).toContain("www." + NEW_HOST)
    expect(live).toContain("WEB_APP_URL")
    expect(live).toContain("Resend")
  })
})
