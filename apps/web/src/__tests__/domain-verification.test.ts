import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  superAdmin: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  resolveTxt: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
  },
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/super-admin", () => ({ isSuperAdmin: mocks.superAdmin }))
vi.mock("dns", () => ({ default: { promises: { resolveTxt: mocks.resolveTxt } } }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert },
}))

import {
  canManageTenantDomain,
  checkDnsRecord,
  checkEmailDnsRecords,
  generateDkimKeyPair,
  markDnsVerified,
  toClientEmailVerification,
  upsertDnsVerification,
} from "@/lib/domain-verification"

import { GET as dnsGet, POST as dnsPost } from "@/app/api/dns/verify/route"
import { GET as emailGet, POST as emailPost } from "@/app/api/email/verify/route"
import { GET as sslGet } from "@/app/api/ssl/status/route"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.updateResults = []

  // Every chained select pops the next queued result set.
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    for: () => selectChain,
    limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
    then: (resolve: any, reject: any) => Promise.resolve(mocks.state.selectResults.shift() ?? []).then(resolve, reject),
  }
  mocks.select.mockReturnValue(selectChain)

  // Update chains pop the queued returning rows.
  mocks.update.mockImplementation(() => {
    const result = mocks.state.updateResults.shift() ?? []
    const updateChain: any = {
      set: () => updateChain,
      where: () => updateChain,
      returning: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    }
    return updateChain
  })
  mocks.insert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([]) }) })
  mocks.resolveTxt.mockRejectedValue(new Error("no dns in unit tests"))
})

const TENANT = "00000000-0000-4000-8000-000000000020"

const nextReq = (path: string, init?: RequestInit) =>
  new NextRequest(
    `https://app.test${path}`,
    init as ConstructorParameters<typeof NextRequest>[1],
  )

// ─── Authority ────────────────────────────────────────────────

describe("domain management authority", () => {
  it("grants super admins without further checks", async () => {
    mocks.superAdmin.mockResolvedValue(true)
    expect(await canManageTenantDomain("clerk-1", TENANT)).toBe(true)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("grants exactly the league owner and no one else", async () => {
    mocks.superAdmin.mockResolvedValue(false)
    mocks.state.selectResults = [[{ id: "actor-1" }], [{ id: TENANT }]] // actor, owned tenant
    expect(await canManageTenantDomain("clerk-1", TENANT)).toBe(true)

    mocks.state.selectResults = [[{ id: "actor-1" }], []] // actor, foreign tenant
    expect(await canManageTenantDomain("clerk-1", TENANT)).toBe(false)

    mocks.state.selectResults = [[]] // unknown actor
    expect(await canManageTenantDomain("clerk-1", TENANT)).toBe(false)
  })
})

// ─── DNS primitives ───────────────────────────────────────────

describe("dns record check", () => {
  it("matches the expected token within a TXT chunk (exact or substring)", async () => {
    mocks.resolveTxt.mockResolvedValue([["unrelated"], ["ssl-verify-abc123reserved"]])
    expect(await checkDnsRecord("ssl.example", "txt", "ssl-verify-abc123")).toBe(true)
    expect(mocks.resolveTxt).toHaveBeenCalledWith("_ssl-verify.ssl.example")
  })

  // Known boundary of the pre-existing implementation: values split across
  // chunks (255-byte TXT strings) do not reassemble, so a long token split
  // mid-way reads as unverified.
  it("does not reassemble a token split across chunks", async () => {
    mocks.resolveTxt.mockResolvedValue([["ssl-verify-", "abc123"]])
    expect(await checkDnsRecord("ssl.example", "txt", "ssl-verify-abc123")).toBe(false)
  })

  it("fails closed on mismatch, unsupported type and resolver errors", async () => {
    mocks.resolveTxt.mockResolvedValue([["unrelated"]])
    expect(await checkDnsRecord("ssl.example", "txt", "ssl-verify-x")).toBe(false)
    expect(await checkDnsRecord("ssl.example", "cname", "ssl-verify-x")).toBe(false)
    // Default mock rejects — resolver errors must read as unverified, not throw.
    expect(await checkDnsRecord("ssl.example", "txt", "ssl-verify-x")).toBe(false)
  })
})

describe("dns verification minting", () => {
  it("rotates by updating the existing verification row", async () => {
    mocks.state.selectResults = [[{ id: "v-old", tenantId: TENANT, domain: "ssl.example" }]]
    mocks.state.updateResults = [[{ id: "v-old", status: "pending" }]]

    const row = await upsertDnsVerification(TENANT, "ssl.example")
    expect(row.id).toBe("v-old")
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("inserts when no verification exists", async () => {
    mocks.state.selectResults = [[]]
    const inserted = { id: "v-new", tenantId: TENANT }
    mocks.insert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([inserted]) }) })

    expect(await upsertDnsVerification(TENANT, "ssl.example")).toEqual(inserted)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("verified dns writes hit both rows", () => {
  it("marks the verification and stamps the tenant", async () => {
    await markDnsVerified("v-1", TENANT, new Date("2026-10-15T00:00:00Z"))
    expect(mocks.update).toHaveBeenCalledTimes(2)
  })
})

// ─── Email domain primitives ─────────────────────────────────

const emailRow = {
  id: "ev-1", tenantId: TENANT, domain: "mail.example", senderEmail: "no-reply@mail.example",
  dkimPublicKey: "v=DKIM1; k=rsa; p=PUBLIC", dkimPrivateKey: "-----BEGIN PRIVATE KEY-----SECRET",
  dkimSelector: "default", spfRecord: "v=spf1 include:_spf.ssl.mtkcodex.site ~all",
  dmarcRecord: "v=DMARC1; p=none; rua=mailto:dmarc@ssl.mtkcodex.site", status: "pending",
} as any

describe("email domain verification", () => {
  it("requires SPF, DMARC and DKIM before reporting verified", async () => {
    mocks.resolveTxt.mockImplementation(async (name: string) => {
      if (name.startsWith("_dmarc.")) return [["v=DMARC1; p=none; rua=mailto:dmarc@ssl.mtkcodex.site"]]
      if (name.startsWith("default._domainkey.")) return [["v=DKIM1; k=rsa; p=PUBLIC-extra"]]
      if (name === "mail.example") return [["v=spf1 include:_spf.ssl.mtkcodex.site ~all"]]
      throw new Error(`unexpected lookup ${name}`)
    })
    expect(await checkEmailDnsRecords("mail.example", emailRow)).toBe(true)

    // A missing DKIM record must fail the whole check even with SPF+DMARC present.
    mocks.resolveTxt.mockImplementation(async (name: string) => {
      if (name.startsWith("default._domainkey.")) throw new Error("NXDOMAIN")
      return [["v=spf1 include:_spf.ssl.mtkcodex.site ~all"]]
    })
    expect(await checkEmailDnsRecords("mail.example", emailRow)).toBe(false)
  })

  it("never returns the DKIM private key to clients", () => {
    const client = toClientEmailVerification(emailRow)
    expect(JSON.stringify(client)).not.toContain("BEGIN PRIVATE KEY")
    expect(client.dkimPublicKey).toBe("v=DKIM1; k=rsa; p=PUBLIC")
    expect(client.dkimSelector).toBe("default")
  })

  it("generates a parseable RSA key pair with a publishable TXT record", () => {
    const { dkimPublicKeyRecord, dkimPrivateKeyPem } = generateDkimKeyPair()
    expect(dkimPublicKeyRecord).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/]+$/)
    expect(dkimPrivateKeyPem).toContain("-----BEGIN PRIVATE KEY-----")
    expect(dkimPrivateKeyPem.length).toBeGreaterThan(1000) // RSA 2048 PKCS#8 PEM
  })
})

// ─── Route gates ──────────────────────────────────────────────

describe("domain verification route gates", () => {
  it("dns: 401 unauthenticated before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect((await dnsGet(nextReq(`/api/dns/verify?domain=x.test&tenantId=${TENANT}`))).status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("dns: 400 on invalid domain or tenant id", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-1" })
    mocks.superAdmin.mockResolvedValue(true)
    expect((await dnsGet(nextReq(`/api/dns/verify?domain=bad%20domain!!&tenantId=${TENANT}`))).status).toBe(400)
    expect((await dnsGet(nextReq("/api/dns/verify?domain=x.test&tenantId=not-a-uuid"))).status).toBe(400)
    const response = await dnsPost(nextReq("/api/dns/verify", {
      method: "POST", body: JSON.stringify({ domain: "ok.test", tenantId: "nope" }),
    }))
    expect(response.status).toBe(400)
  })

  it("dns: 409 when the domain is not the league's assigned domain", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-1" })
    mocks.superAdmin.mockResolvedValue(false)
    mocks.state.selectResults = [
      [{ id: TENANT, customDomain: "other.test", plan: "enterprise", ownerId: "a1" }], // tenant read
      [{ id: "a1" }], // actor for the authority check
      [{ id: TENANT, ownerId: "a1" }], // owned-tenant check
    ]
    const response = await dnsGet(nextReq(`/api/dns/verify?domain=ssl.example&tenantId=${TENANT}`))
    expect(response.status).toBe(409)
  })

  it("email: 403 for a non-super-admin before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-1" })
    mocks.superAdmin.mockResolvedValue(false)
    expect((await emailGet(nextReq(`/api/email/verify?domain=x.test&tenantId=${TENANT}`))).status).toBe(403)
    expect((await emailPost(nextReq("/api/email/verify"))).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("email: 400 on a malformed sender email", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-1" })
    mocks.superAdmin.mockResolvedValue(true)
    const response = await emailPost(nextReq("/api/email/verify", {
      method: "POST",
      body: JSON.stringify({ domain: "mail.test", tenantId: TENANT, senderEmail: "not-an-email" }),
    }))
    expect(response.status).toBe(400)
  })

  it("ssl: 403 for a non-super-admin, 401 unauthenticated", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-1" })
    mocks.superAdmin.mockResolvedValue(false)
    expect((await sslGet(nextReq(`/api/ssl/status?domain=x.test&tenantId=${TENANT}`))).status).toBe(403)

    mocks.auth.mockResolvedValue({ userId: null })
    expect((await sslGet(nextReq(`/api/ssl/status?domain=x.test&tenantId=${TENANT}`))).status).toBe(401)
  })
})
