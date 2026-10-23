import { buildTenantManifest } from "@/lib/white-label-metadata"
import { readRequestBrand } from "@/lib/request-brand"

/**
 * Batch 123: the PWA manifest is now per-host white-label metadata, served
 * from `/manifest.webmanifest` (Next's file convention emits the correct
 * `application/manifest+json` content type). The branded tenant's installed
 * app carries THE TENANT'S name and theme color; an unconfigured host gets
 * the platform manifest unchanged. Request-local read via `readRequestBrand`
 * — never cached globally, never leaking one tenant's brand to another.
 * fs-pinned only in tests (transitively imports Clerk via request-brand).
 */
export default async function Manifest() {
  const brand = await readRequestBrand()
  return buildTenantManifest(brand)
}
