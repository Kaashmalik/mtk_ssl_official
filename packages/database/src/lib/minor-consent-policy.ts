/**
 * Minor consent policy (PUB-06 + REG-06 slice, Batch 132).
 *
 * Consent-on-publication, recorded default 2026-10-18: a player whose
 * recorded date_of_birth puts them under 18 is a MINOR; a minor's public
 * records are visible ONLY while a guardian consent is recorded on the
 * player row. The consent is a league-RECORDED fact (guardian name +
 * instant + who recorded it), never a platform-verified identity. A missing
 * date_of_birth is never guessed into a minor: without recorded data the
 * league cannot know, so public behavior is unchanged and the disclosure
 * lives in the readers and the register, not in a fabricated age.
 */

export const MINOR_AGE_THRESHOLD = 18

/** Age in whole years at `at`, or null when no date of birth is recorded. */
export function playerAgeYears(dateOfBirth: string | Date | null | undefined, at: Date = new Date()): number | null {
  if (!dateOfBirth) return null
  const dob = typeof dateOfBirth === "string" ? new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`) : dateOfBirth
  if (Number.isNaN(dob.getTime())) return null
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

/**
 * True when the player is a minor BY RECORDED DATA only. No date of birth
 * unparseable) is never a minor - the readers must not guess.
 */
export function isMinorByRecord(dateOfBirth: string | Date | null | undefined, at: Date = new Date()): boolean {
  const age = playerAgeYears(dateOfBirth, at)
  return age !== null && age < MINOR_AGE_THRESHOLD
}

export type MinorPublicDecision =
  | { visible: true; basis: "adult" | "not_provable" | "guardian_consent" }
  | { visible: false; basis: "minor_without_consent" }

/**
 * The public-visibility decision for one player row, fail-closed:
 * adults are public as before; a proven minor needs the recorded guardian
 * consent; a minor without it is withheld from public surfaces. Unprovable
 * ages keep existing public behavior (disclosed, never guessed).
 */
export function minorPublicDecision(
  dateOfBirth: string | Date | null | undefined,
  guardianConsentAt: Date | string | null | undefined,
  at: Date = new Date(),
): MinorPublicDecision {
  if (!isMinorByRecord(dateOfBirth, at)) {
    return { visible: true, basis: playerAgeYears(dateOfBirth, at) === null ? "not_provable" : "adult" }
  }
  const consent = guardianConsentAt
    ? typeof guardianConsentAt === "string" ? new Date(guardianConsentAt) : guardianConsentAt
    : null
  if (consent && !Number.isNaN(consent.getTime()) && consent.getTime() <= at.getTime()) {
    return { visible: true, basis: "guardian_consent" }
  }
  return { visible: false, basis: "minor_without_consent" }
}

/** UI copy - tested verbatim, never improvised in components. */
export const MINOR_CONSENT_LABELS = {
  minor: "Minor (recorded date of birth)",
  adult: "Adult",
  unknownAge: "Age unknown - recorded date of birth required to gate visibility",
  consentRecorded: "Guardian consent recorded",
  consentMissing: "No guardian consent - hidden from public records",
  saveTitle: "Record guardian consent",
  withdrawTitle: "Withdraw guardian consent",
  guardianName: "Guardian name (league record, not verified)",
  disclosure:
    "Minors stay off public leaderboards and career records unless guardian consent is recorded. The consent is a league record, not a platform check.",
} as const
