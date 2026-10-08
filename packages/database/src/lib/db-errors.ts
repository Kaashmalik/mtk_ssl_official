/**
 * Postgres error helpers.
 */

/**
 * Postgres unique-violation (SQLSTATE 23505).
 *
 * Surfaces on `.cause.code` for postgres-js and directly on `.code` for
 * node-postgres, so both are checked.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: string; cause?: { code?: string } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}
