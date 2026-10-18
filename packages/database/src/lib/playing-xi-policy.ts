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
  /** PUB-03/COMP-06: designate this slot as the side's wicketkeeper. */
  wicketkeeper?: boolean
}

/** Validates one side's declared XI shape: exactly 11 distinct players, orders 1..11. */
export function validateDeclaredXi(entries: XiDeclarationEntry[], teamId: string): void {
  if (!Array.isArray(entries) || entries.length !== PLAYING_XI_SIZE) {
    throw new Error(`Team ${teamId} must declare exactly ${PLAYING_XI_SIZE} players`)
  }
  const playerIds = new Set<string>()
  const orders = new Set<number>()
  let keepers = 0
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
    if (entry.wicketkeeper === true) keepers++
    playerIds.add(entry.playerId)
    orders.add(entry.battingOrder)
  }
  if (keepers > 1) {
    throw new Error(`Team ${teamId} cannot designate more than one wicketkeeper`)
  }
}

/** A designated keeper is one honest fact on one XI slot; the DB unique enforces it. */
export function entryIsWicketkeeper(entry: Pick<XiDeclarationEntry, "wicketkeeper">): boolean {
  return entry.wicketkeeper === true
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

export interface XiSubstitutionInput {
  /** Active declared rows for BOTH sides (superseded_at IS NULL). */
  activeRows: ActiveXiRow[]
  /** Side performing the substitution. */
  teamId: string
  outgoingPlayerId: string
  incomingPlayerId: string
}

/**
 * Validates a substitution (SCORE-10) against the ACTIVE declared XIs and
 * returns the outgoing row's batting order so the replacement inherits the
 * slot. Fail closed: the outgoing player must be an active XI member of the
 * substituting side, the incoming player must be entirely absent from BOTH
 * sides' current XIs, and the sides' active XI shape must stay intact. The
 * replacement row itself is written by the locked writer, which separately
 * re-checks registered-squad and roster eligibility for the incoming player.
 */
export function xiSubstitutionOrder(input: XiSubstitutionInput): number {
  const { activeRows, teamId, outgoingPlayerId, incomingPlayerId } = input
  if (teamId === "" || outgoingPlayerId === "" || incomingPlayerId === "") {
    throw new Error("Substitution requires an outgoing and an incoming player")
  }
  if (outgoingPlayerId === incomingPlayerId) {
    throw new Error("The substitution must name two different players")
  }
  const sideRows = activeRows.filter(row => row.teamId === teamId)
  const outgoing = sideRows.find(row => row.playerId === outgoingPlayerId)
  if (!outgoing) throw new Error("The outgoing player is not in the declared playing XI")
  if (sideRows.some(row => row.playerId === incomingPlayerId)) {
    throw new Error("The incoming player is already in the declared playing XI")
  }
  const otherSide = activeRows.find(row => row.teamId !== teamId && row.playerId === incomingPlayerId)
  if (otherSide) throw new Error("The incoming player is declared for the other side")
  return outgoing.battingOrder
}
