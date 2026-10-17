import { xiIsApproved } from "@mtk/database/lib/playing-xi-policy"

/**
 * Pure derivations for the declared-playing-XI card (COMP-06 slice, Batch 81).
 * Presentation-only: the server writer re-validates everything under a lock,
 * so these helpers size controls and shape copy, never authorize.
 */

export interface XiEntry {
  playerId: string
  battingOrder: number
}

export interface ActiveXiPlayer extends XiEntry {
  name: string
}

export type XiGateState = "notDeclared" | "pendingApproval" | "approved"

/** Same split the shared policy and the canonical boundary enforce. */
export function xiGateStatus(match: {
  xiRequired?: boolean | null
  xiApprovedAt?: Date | string | null
}): XiGateState {
  if (match.xiRequired !== true) return "notDeclared"
  return xiIsApproved(match) ? "approved" : "pendingApproval"
}

/** Exactly-11 distinct selection check mirrors the shared policy client-side. */
export function xiDeclarationFromSlots(
  slots: ReadonlyArray<string | null | undefined>,
  teamLabel: string,
): { entries: XiEntry[]; error: string | null } {
  if (slots.length !== 11) return { entries: [], error: `${teamLabel} needs exactly 11 slots` }
  const filled = slots.filter((slot): slot is string => slot !== null && slot !== undefined && slot !== "")
  if (filled.length !== 11) return { entries: [], error: `${teamLabel} needs all 11 players selected` }
  if (new Set(filled).size !== 11) {
    return { entries: [], error: `${teamLabel} cannot select the same player twice` }
  }
  return { entries: filled.map((playerId, i) => ({ playerId, battingOrder: i + 1 })), error: null }
}

export function xiStatusLabel(state: XiGateState, approvedAt?: Date | string | null): string {
  if (state === "notDeclared") return "Playing XIs not declared yet"
  if (state === "pendingApproval") return "Declared — awaiting official approval"
  if (approvedAt instanceof Date) {
    return `Officially approved (${approvedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
  }
  if (typeof approvedAt === "string" && approvedAt !== "" && !Number.isNaN(new Date(approvedAt).getTime())) {
    return `Officially approved (${new Date(approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
  }
  return "Officially approved"
}

/** A friendly or any non-scheduled match can never declare (writer re-checks). */
export function xiCanDeclare(match: { status: string | null; tournamentId: string | null | undefined }): boolean {
  return match.tournamentId !== null && match.tournamentId !== undefined && match.status === "scheduled"
}

/** Prefill the slots from the active declared XI (sorted), else empty slots. */
export function xiInitialSlots(active?: ActiveXiPlayer[]): (string | null)[] {
  const sorted = [...(active ?? [])].sort((a, b) => a.battingOrder - b.battingOrder)
  if (sorted.length === 11) return sorted.map(player => player.playerId)
  return Array.from({ length: 11 }, () => null)
}
