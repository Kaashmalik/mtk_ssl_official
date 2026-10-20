/**
 * ENH-03-01: the transport error contract.
 *
 * Every refusing surface - server actions, BFF routes, the scoring service
 * proxy - maps its refusal onto exactly one of these codes, so a client can
 * branch on MEANING (retry vs re-auth vs give up) without string-matching
 * server prose. Prose stays transport-specific; codes are the contract.
 *
 * Pure TypeScript only.
 */

export const CONTRACT_ERROR_CODE_VALUES = [
  /** The payload did not satisfy its command schema. Do not retry. */
  "invalid_command",
  /** No session / expired credentials. Re-authenticate. */
  "unauthorized",
  /** Authenticated but not allowed for this tenant/league/action. */
  "forbidden",
  /** The entity does not exist - or is deliberately indistinguishable. */
  "not_found",
  /** Another actor already produced this effect (idempotent duplicate). */
  "conflict",
  /** Optimistic-concurrency loss: the caller's expectedRevision is stale. */
  "conflict_stale_revision",
  /** SCORE-11 handover fencing: another scoring session owns the match. */
  "conflict_handover_epoch",
  /** The in-memory/token-bucket limiter refused. Back off, then retry. */
  "rate_limited",
  /** A dependency (database/service/provider) is currently unavailable. */
  "unavailable",
  /** Unexpected server failure. Safe to report; never retry blindly. */
  "internal",
] as const
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODE_VALUES)[number]

export type ContractError = {
  code: ContractErrorCode
  /** Human-readable, already-localized-or-English prose from the server. */
  message: string
  /** Optional structured details (e.g. current revision for conflicts). */
  details?: Record<string, unknown>
}

export function contractError(code: ContractErrorCode, message: string, details?: Record<string, unknown>): ContractError {
  return details ? { code, message, details } : { code, message }
}

/** Narrow an unknown thrown/returned value into a ContractError safely. */
export function isContractError(value: unknown): value is ContractError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { code?: unknown }).code === "string" &&
    (CONTRACT_ERROR_CODE_VALUES as readonly string[]).includes(
      (value as { code: string }).code,
    ) &&
    typeof (value as { message?: unknown }).message === "string"
  )
}
