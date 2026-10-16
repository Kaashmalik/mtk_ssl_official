/**
 * Verified player records + consented career linkage (PUB-03).
 *
 * THE MODEL
 *  - A "verified player record" is a roster entry bound to a real, active
 *    user account through `players.user_id`. Identity is the verification:
 *    name-only roster rows (no linked account) are NEVER marked verified, and
 *    a suspended or deleted account (`isActive !== true`) voids verification
 *    — the same fail-closed posture as membership effectiveness (SCORE-09).
 *    No mutable "verified" boolean exists: it cannot be granted, foreclosed,
 *    or drift.
 *  - Cross-league career linkage folds one person's published per-league
 *    performances into a single career view. That is an identity-level
 *    decision spanning league boundaries, so it is governed by the PERSON's
 *    affirmative consent: `users.public_career_consent_at`. Absent consent
 *    the gate is closed — each league's public surface keeps showing only
 *    that league's numbers (PUB-02's cross-league hub MUST call
 *    `mergeConsentedCareer` and fail closed on `null`).
 *  - Consent never changes what a single league may publish. Per-league
 *    publication predicates (published tournaments/matches, tenant scope)
 *    remain the authority for every league's own numbers; this module's
 *    consent gate and fold are strictly ADDITIVE on top of
 *    already-public per-league totals. Callers must have derived each
 *    league's totals under that league's own predicates — the fold here is
 *    not a publication decision itself.
 *
 * These pure functions are the single source of truth for both gates; UI
 * surfaces derive their markers from them (web app and future cross-league
 * hub share this module via the root `@mtk/database` export).
 */

/**
 * Verified roster identity: the player row is linked to an account that is
 * currently active. Unlinked rows and inactive accounts both fail closed.
 */
export function isVerifiedPlayerRecord(
  player: { userId: string | null },
  user: { isActive: boolean } | null | undefined,
): boolean {
  return player.userId !== null && !!user && user.isActive === true
}

/**
 * Affirmative public-career consent: the person has explicitly granted (and
 * not revoked) cross-league linkage. Null means never granted.
 */
export function careerConsentGranted(
  user: { publicCareerConsentAt: Date | null } | null | undefined,
): boolean {
  return !!user && user.publicCareerConsentAt !== null
}

/** One league's already-published, identity-attributed career totals. */
export type CareerLeagueTotals = {
  /** The league (tenant) these totals were published in. */
  tenantId: string
  runsScored: number
  wicketsTaken: number
}

/** The consented, folded career view. Leagues keep their provenance. */
export type ConsentedCareer = {
  leagues: CareerLeagueTotals[]
  totalRunsScored: number
  totalWicketsTaken: number
}

/**
 * Consent gate + fold for cross-league career linkage (PUB-02's hub calls
 * this; nothing else may merge across leagues). Without consent the result
 * is `null` — fail closed. A league appearing more than once is a caller
 * bug (one authoritative totals row per league) and throws rather than
 * double-counting a person's career.
 */
export function mergeConsentedCareer(
  leagues: CareerLeagueTotals[],
  consented: boolean,
): ConsentedCareer | null {
  if (!consented) return null
  const seen = new Set<string>()
  let totalRunsScored = 0
  let totalWicketsTaken = 0
  for (const league of leagues) {
    if (seen.has(league.tenantId)) {
      throw new Error(`Duplicate league totals for career merge: ${league.tenantId}`)
    }
    seen.add(league.tenantId)
    totalRunsScored += league.runsScored
    totalWicketsTaken += league.wicketsTaken
  }
  return { leagues: [...leagues], totalRunsScored, totalWicketsTaken }
}
