import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { InvitedEmailVerification } from "@/components/users/invited-email-verification"
import { InviteManager } from "@/components/users/invite-manager"

const mocks = vi.hoisted(() => ({ user: vi.fn() }))
vi.mock("@clerk/nextjs", () => ({ useUser: mocks.user }))
vi.mock("@/app/actions/users-invites", () => ({ createInvite: vi.fn(), getInvites: vi.fn(), revokeInvite: vi.fn() }))
vi.mock("@/app/actions/teams", () => ({ getTeams: vi.fn() }))
vi.mock("@mtk/ui/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>, SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: () => null, SelectContent: ({ children }: any) => <div>{children}</div>, SelectItem: ({ children }: any) => <span>{children}</span>,
}))
beforeEach(() => {
  mocks.user.mockReturnValue({ user: { id: "user", emailAddresses: [{ id: "email", emailAddress: "ali@example.test", verification: { status: "unverified" } }] } })
})
describe("Invitation verification/UI contracts (SSR and source, not browser/OTP certification)", () => {
  it("shows provider verification as identity proof, not a membership grant", () => {
    const html = renderToStaticMarkup(<InvitedEmailVerification email="ali@example.test" onVerified={() => {}} />)
    expect(html).toContain("Verification alone does not grant league access")
    expect(html).toContain("Request verification code")
    expect(html).toContain('aria-live="polite"')
  })
  it("never posts/logs verification codes to application server actions", () => {
    const source = readFileSync(new URL("../components/users/invited-email-verification.tsx", import.meta.url), "utf8")
    expect(source).toContain('prepareVerification({ strategy: "email_code" })')
    expect(source).toContain("attemptVerification({ code: code.trim() })")
    expect(source).not.toContain("console.")
    expect(source).not.toContain("fetch(")
    expect(source).not.toContain("@/app/actions")
    expect(source).toContain('autoComplete="one-time-code"')
    expect(source).toContain("setCooldown(60)")
  })
  it("requires signed-in verified invited email in UI, with independent server verification", () => {
    const source = readFileSync(new URL("../app/accept-invite/page.tsx", import.meta.url), "utf8")
    expect(source).toContain("disabled={isPending || !verified}")
    expect(source).toContain("acceptInvite(token)")
    expect(source).toContain("recipientEmail")
    expect(source).toContain("cancelled = true")
    expect(source).not.toContain("console.")
    expect(source).not.toContain("localStorage")
  })
  it("manager requires a team, describes league-only coach/scorer scope and honest delivery limits", () => {
    const html = renderToStaticMarkup(<InviteManager tenantId="league" />)
    expect(html).toContain("Choose a team")
    expect(html).not.toContain("Whole league")
    expect(html).toContain("Team-scoped coach/scorer grants are not available")
    expect(html).toContain("email delivery is not tracked yet")
    expect(html).toContain('aria-label="Team for invited manager"')
  })
  it("clear failure/conflict handling replaces silently retained private invitation data", () => {
    const source = readFileSync(new URL("../components/users/invite-manager.tsx", import.meta.url), "utf8")
    expect(source).toContain("setRows([])")
    expect(source).toContain("setLastLink(null)")
    expect(source).toContain("getInvites(tenantId)")
    expect(source).toContain("revokeInvite({ tenantId, inviteId: r.id })")
    expect(source).toContain("email outcome is unknown")
    expect(source).toContain("Clipboard access failed")
    expect(source).toContain("user?.id")
  })
  it("sensitive handoff routes override general referrer policy and discourage caching/indexing", () => {
    // Do not require next.config: it reads root environment files during startup.
    const config = readFileSync(new URL("../../next.config.js", import.meta.url), "utf8")
    const sensitiveHeaders = config.slice(config.indexOf('...["/accept-invite"'))
    expect(sensitiveHeaders).toContain('"/sign-in/:path*", "/sign-up/:path*"')
    expect(sensitiveHeaders).toContain('"Referrer-Policy", value: "no-referrer"')
    expect(sensitiveHeaders).toContain('"Cache-Control", value: "private, no-store"')
    expect(sensitiveHeaders).toContain('"X-Robots-Tag", value: "noindex, nofollow"')
  })
})
