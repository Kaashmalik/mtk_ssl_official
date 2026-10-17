/**
 * Shared playing-XI policy (COMP-06 slice).
 *
 * A tournament match whose XI requirement is armed (`xi_required`) carries two
 * declared squads that an official has approved. Enforcement is deliberately
 * legacy-safe, mirroring scorer/umpire consent:
 *  - `xiRequired` absent/false (never declared) -> `off`: registered-squad
 *    rules keep being the only eligibility gate; readiness shows XI as
 *    recommended, never blocking.
 *  - armed but `xiApprovedAt` pending -> `pendingApproval`: both XIs exist but
 *    no official has approved; the canonical boundary refuses deliveries.
 *  - armed and approved -> `enforced`: every delivery participant must be on
 *    their side's ACTIVE declared XI.
 *
 * Fail-closed: partial, unbounded or duplicate declarations are invalid; a
 * malformed/missing approval state never reads as approved. The caller supplies
 * only rows known to be active (superseded_at IS NULL).
 */
export const PLAYING_XI_SIZE = 11

export interface XiDeclarationEntry {
  playerId: string
  battingOrder: number
}

/** Validates one side's declared XI shape: exactly 11 distinct players, orders 1..11. */
export function validateDeclaredXi(entries: XiDeclarationEntry[], teamId: string): void {
  if (!Array.isArray(entries) || entries.length !== PLAYING_XI_SIZE) {
    throw new Error(`Team ${teamId} must declare exactly ${PLAYING_XI_SIZE} players`)
  }
  const playerIds = new Set<string>()
  const orders = new Set<number>()
  for (const entry of entries) {
    if (!entry || typeof entry.playerId !== "string" || entry.playerId.length === 0) {
      throw new Error(`Team ${teamId} declared an invalid player entry`)
    }
    if (playerIds.has(entry.playerId)) throw new Error(`Team ${teamId} declared a player twice`)
    if (entry.battingOrder !== Math.floor(entry.battingOrder)
      || entry.battingOrder < 1 || entry.battingOrder > PLAYING_XI_SIZE) {
      throw new Error(`Team ${teamId} batting orders must be 1..${PLAYING_XI_SIZE}`)
    }
    if (orders.has(entry.battingOrder)) throw new Error(`Team ${teamId} declared a batting order twice`)
    playerIds.add(entry.playerId)
    orders.add(entry.battingOrder)
  }
}

export type XiEnforcement = "off" | "pendingApproval" | "enforced"

interface XiMatchState {
  xiRequired?: boolean | null
  xiApprovedAt?: Date | string | null
}

/** True only when the approval instant parses to a real past-or-present moment. */
export function xiIsApproved(match: XiMatchState, now: Date = new Date()): boolean {
  if (!match || match.xiApprovedAt === null || match.xiApprovedAt === undefined) return false
  const approvedAt = match.xiApprovedAt instanceof Date
    ? match.xiApprovedAt
    : new Date(match.xiApprovedAt as string)
  return !Number.isNaN(approvedAt.getTime()) && approvedAt.getTime() <= now.getTime()
}

export function xiEnforcementLevel(match: XiMatchState): XiEnforcement {
  if (!match || match.xiRequired !== true) return "off"
  return xiIsApproved(match) ? "enforced" : "pendingApproval"
}

export interface ActiveXiRow {
  teamId: string
  playerId: string
  battingOrder: number
}

/**
 * True when every delivered participant is an active XI member of their own
 * side. The caller passes the active rows for BOTH teams; a side with a
 * missing/partial XI fails closed (the canonical boundary already blocks
 * that state at the pendingApproval level, but stale/corrupt rows here are
 * rejected too rather than waived).
 */
export function xiCoversParticipants(
  rows: ActiveXiRow[],
  participants: ReadonlyMap<string, string>,
): boolean {
  const bySide = new Map<string, Map<string, number>>()
  for (const row of rows) {
    let side = bySide.get(row.teamId)
    if (!side) {
      side = new Map<string, number>()
      bySide.set(row.teamId, side)
    }
    if (side.get(row.playerId) === row.battingOrder) return false
    side.set(row.playerId, row.battingOrder)
  }
  for (const [playerId, teamId] of participants) {
    const side = bySide.get(teamId)
    if (!side || !side.has(playerId)) return false
    if (side.size !== PLAYING_XI_SIZE) return false
  }
  return true
}
