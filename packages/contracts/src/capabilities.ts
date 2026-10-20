/**
 * ENH-03-01: surface capability contract.
 *
 * A SURFACE is a distinct execution environment with its own trust-posture
 * and audience. Capabilities answer "may this surface offer this operation
 * in its UI at all" - coarse product geography, NOT per-user authorization
 * (which always stays server-side: capability flags gate what surfaces may
 * PROMISE, authority checks decide what a caller may DO).
 *
 * Versioned so native builds can feature-detect the capability sheet that
 * matches their release. Pure TypeScript only.
 */

export const CAPABILITIES_VERSION = 1 as const

export const SURFACE_IDS = ["public", "member", "organizer", "admin"] as const
export type SurfaceId = (typeof SURFACE_IDS)[number]

export const CAPABILITY_KEYS = [
  /** Read published (anonymous) league content. */
  "readPublic",
  /** Read signed-in-member surfaces (own profile, own applications, own predictions). */
  "readMember",
  /** Submit tournament/league applications and replies. */
  "submitApplication",
  /** Submit scoring commands (record ball, manage XI). */
  "submitScore",
  /** Create/manage league resources (teams, fixtures, venues, tournaments). */
  "manageLeague",
  /** Review registrations and decisions (league owner/admin console). */
  "reviewRegistrations",
  /** Platform-level administration (tenants, users, impersonation-free ops). */
  "administerPlatform",
] as const
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number]

export type SurfaceCapabilities = Record<CapabilityKey, boolean>

/**
 * The v1 capability sheet. Deliberately static data: a surface's OFFERINGS
 * change with product decisions, not with caller identity. The native app
 * reads this to decide which flows to render; every flow still re-verifies
 * authority server-side on every command.
 */
export const SURFACE_CAPABILITIES: Record<SurfaceId, SurfaceCapabilities> = {
  public: {
    readPublic: true,
    readMember: false,
    submitApplication: false,
    submitScore: false,
    manageLeague: false,
    reviewRegistrations: false,
    administerPlatform: false,
  },
  member: {
    readPublic: true,
    readMember: true,
    submitApplication: true,
    submitScore: false,
    manageLeague: false,
    reviewRegistrations: false,
    administerPlatform: false,
  },
  organizer: {
    readPublic: true,
    readMember: true,
    submitApplication: false,
    submitScore: true,
    manageLeague: true,
    reviewRegistrations: true,
    administerPlatform: false,
  },
  admin: {
    readPublic: true,
    readMember: true,
    submitApplication: false,
    submitScore: true,
    manageLeague: true,
    reviewRegistrations: true,
    administerPlatform: true,
  },
}

/** Type-safe lookup; unknown surfaces fail without a fallback grant. */
export function capabilitiesFor(surface: string): SurfaceCapabilities | null {
  return surface in SURFACE_CAPABILITIES ? SURFACE_CAPABILITIES[surface as SurfaceId] : null
}
