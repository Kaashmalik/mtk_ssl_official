/**
 * ENH-01-04: field-injection guards for the generic tenant-scoped repository.
 *
 * The repo's write methods previously applied caller-supplied payloads
 * verbatim. Every QUERY is tenant-scoped, but the WRITE side could still
 * mutate the fields that define where a row lives and who owns it: a payload
 * containing `tenantId` could MOVE a row into another tenant, and an explicit
 * `id` could re-key a primary key. Authority flows (roles, ownership caps)
 * keep their dedicated writers; the generic path refuses the identity keys.
 */

/** Keys the generic repository never accepts in a caller-supplied payload. */
export const PROTECTED_WRITE_FIELDS = ["tenantId", "id"] as const;

export type ProtectedWriteField = (typeof PROTECTED_WRITE_FIELDS)[number];

/**
 * Throws when the payload tries to set a protected field; passes the payload
 * through untouched otherwise. The error names the exact offending key so the
 * caller's bug is obvious in logs.
 */
export function assertWritableFields<T extends Record<string, unknown>>(values: T): T {
  for (const field of PROTECTED_WRITE_FIELDS) {
    if (field in values) {
      throw new Error(
        `[repo] Field "${field}" is identity-scoped and cannot be written through the generic repository. Use the dedicated tenant/identity writers.`,
      );
    }
  }
  return values
}
