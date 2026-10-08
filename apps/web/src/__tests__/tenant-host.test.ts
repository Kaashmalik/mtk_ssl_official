import { describe, it, expect } from "vitest";
import {
  normalizeHost,
  tenantSlugCandidates,
  tenantSlugFromHost,
} from "@/lib/tenant-host";

/**
 * Host parsing underpins public-page tenant isolation. A regression here means a
 * page either 404s for legitimate users, or — worse — resolves no tenant and a
 * caller falls back to an unscoped read.
 */

describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("SSL.MTKCodex.Site:3001")).toBe("ssl.mtkcodex.site");
  });

  it("takes only the first entry of an x-forwarded-host chain", () => {
    expect(normalizeHost("ssl.mtkcodex.site, proxy.internal, 10.0.0.1")).toBe(
      "ssl.mtkcodex.site",
    );
  });

  it("returns empty string for missing hosts", () => {
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
    expect(normalizeHost("")).toBe("");
  });

  it("preserves bracketed IPv6 literals", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });
});

describe("tenantSlugCandidates", () => {
  it("extracts the tenant slug from a subdomain host", () => {
    expect(tenantSlugCandidates("ssl.mtkcodex.site")).toEqual(["ssl"]);
  });

  it("skips a reserved leading label", () => {
    expect(tenantSlugCandidates("www.ssl.mtkcodex.site")).toEqual(["ssl"]);
    expect(tenantSlugCandidates("app.ssl.mtkcodex.site")).toEqual(["ssl"]);
    expect(tenantSlugCandidates("admin.ssl.mtkcodex.site")).toEqual(["ssl"]);
  });

  it("supports a tenant subdomain in local dev", () => {
    expect(tenantSlugCandidates("ssl.localhost")).toEqual(["ssl"]);
  });

  it("returns no candidate for a bare localhost host", () => {
    // No tenant context: public pages must 404 rather than read unscoped.
    expect(tenantSlugCandidates("localhost")).toEqual([]);
  });

  it("returns no candidate for the apex domain", () => {
    // Guards the bug where a naive `parts[0]` would yield "mtkcodex".
    expect(tenantSlugCandidates("mtkcodex.site")).toEqual([]);
  });

  it("returns no candidate when only reserved labels are present", () => {
    expect(tenantSlugCandidates("www.localhost")).toEqual([]);
    expect(tenantSlugCandidates("www.mtkcodex.site")).toEqual([]);
  });

  it("returns no candidate for a single-label host", () => {
    expect(tenantSlugCandidates("localhost")).toEqual([]);
  });

  it("returns no candidate for empty input", () => {
    expect(tenantSlugCandidates("")).toEqual([]);
  });
});

describe("tenantSlugFromHost", () => {
  it("normalises then extracts", () => {
    expect(tenantSlugFromHost("SSL.MTKCodex.Site:3001")).toBe("ssl");
  });

  it("returns null when there is no tenant context", () => {
    expect(tenantSlugFromHost("localhost:3001")).toBeNull();
    expect(tenantSlugFromHost("mtkcodex.site")).toBeNull();
    expect(tenantSlugFromHost(null)).toBeNull();
  });
});
