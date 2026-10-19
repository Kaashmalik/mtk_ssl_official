/** Consume ONLY verified provider session claims, never request JSON or role metadata. */
export const PRIVILEGED_FACTOR_MAX_AGE_MINUTES = 10

export function hasRecentSecondFactor(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false
  const fva = (claims as { fva?: unknown }).fva
  // Clerk's reverification presets can fall back to the first factor for
  // unenrolled users. Privileged operations deliberately DO NOT accept that.
  return Array.isArray(fva) && fva.length === 2 && fva.every(age =>
    typeof age === "number" && Number.isInteger(age) && age >= 0 && age <= PRIVILEGED_FACTOR_MAX_AGE_MINUTES)
}
