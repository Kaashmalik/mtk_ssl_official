/**
 * REG-06 (Batch 149): squad, transfer and participation rules as PURE
 * POLICY. The schema already carries account-less players (players.user_id
 * is nullable -> onDelete set null) and the minor-consent facts (Batch
 * 132). What this adds is the HONEST rule set:
 *   - an account-less player is LEAGUE-RECORDED: no claimant, no
 *     self-service, only the league owner/manager may edit;
 *   - squad composition is a DERIVED answer with named blockers (size
 *     bounds, duplicates, missing guardian consent for minors);
 *   - a transfer is only legal inside one league, for a player not
 *     currently in an active match, and a minor's consent travels with
 *     the player (no re-consent demanded, no silent loss);
 *   - participation requires the player to be in the squad of an
 *     approved + paid/waived registration.
 * No invented eligibility: every refusal names its reason.
 */

export interface SquadPlayer {
  id: string
  userId: string | null
  isMinor: boolean
  guardianConsentAt: string | null
}

export interface SquadCompositionInput {
  players: SquadPlayer[]
  minSize: number
  maxSize: number
}

export interface SquadCompositionResult {
  ok: boolean
  blockers: string[]
}

export function isAccountLessPlayer(player: { userId: string | null }): boolean {
  return player.userId === null || player.userId === undefined || player.userId === ""
}

export function squadCompositionOk(input: SquadCompositionInput): SquadCompositionResult {
  const blockers: string[] = []
  if (!Number.isInteger(input.minSize) || input.minSize < 0) blockers.push("tournament minimum squad size is not configured")
  if (!Number.isInteger(input.maxSize) || input.maxSize < 1) blockers.push("tournament maximum squad size is not configured")
  if (Number.isInteger(input.minSize) && Number.isInteger(input.maxSize) && input.minSize > input.maxSize) {
    blockers.push("tournament squad size bounds are inconsistent")
  }
  const ids = input.players.map((p) => p.id)
  if (new Set(ids).size !== ids.length) blockers.push("duplicate player in squad")
  if (Number.isInteger(input.minSize) && input.players.length < input.minSize) {
    blockers.push(`squad must have at least ${input.minSize} players (currently ${input.players.length})`)
  }
  if (Number.isInteger(input.maxSize) && input.players.length > input.maxSize) {
    blockers.push(`squad may not exceed ${input.maxSize} players (currently ${input.players.length})`)
  }
  for (const player of input.players) {
    if (player.isMinor && !player.guardianConsentAt) {
      blockers.push(`minor ${player.id} has no recorded guardian consent`)
    }
  }
  return { ok: blockers.length === 0, blockers }
}

export interface TransferCheckInput {
  sameLeague: boolean
  playerInActiveMatch: boolean
  minorWithoutConsent: boolean
}

export function canTransfer(input: TransferCheckInput): { ok: boolean; reason: string | null } {
  if (!input.sameLeague) return { ok: false, reason: "transfers are only allowed within the same league" }
  if (input.playerInActiveMatch) return { ok: false, reason: "player is currently in an active match - transfer after it concludes" }
  if (input.minorWithoutConsent) return { ok: false, reason: "minor player has no recorded guardian consent - cannot transfer" }
  return { ok: true, reason: null }
}

export function participationEligible(input: {
  inSquad: boolean
  registrationApproved: boolean
  registrationPaidOrWaived: boolean
}): boolean {
  return input.inSquad && input.registrationApproved && input.registrationPaidOrWaived
}

export function describeSquadBlockers(blockers: string[]): string {
  return blockers.length === 0 ? "Squad is valid for this tournament." : `Squad invalid: ${blockers.join("; ")}.`
}
