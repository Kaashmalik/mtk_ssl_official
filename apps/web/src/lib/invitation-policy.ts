import { z } from "zod"

export const invitationRole = z.enum(["team_manager", "captain", "coach", "scorer", "player"])
export const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation link")
export const normalizeInvitationEmail = (email: string) => email.trim().toLowerCase()

type ProviderUser = {
  id: string
  emailAddresses: { emailAddress: string; verification: { status: string | null } | null }[]
}

/** Provider identity, never a webhook email, client claim or primary-email guess. */
export function hasVerifiedInvitedEmail(provider: ProviderUser | null, clerkId: string, email: string): boolean {
  return provider?.id === clerkId && provider.emailAddresses.some(address =>
    normalizeInvitationEmail(address.emailAddress) === normalizeInvitationEmail(email)
    && address.verification?.status === "verified")
}

/**
 * Invitation scope matrix (REG-05, Batch 134):
 * - team_manager: REQUIRES a team (they manage exactly that team).
 * - captain: REQUIRES a team (redemption assigns that team's captain pointer).
 * - coach / scorer: league-wide (the one-role schema cannot represent
 *   team-scoped coach/scorer grants; the register records this boundary).
 * - player: league-wide (roster-to-team assignment stays in the roster
 *   flows - an invitation never creates a player row).
 */
export function assertSupportedInvitationScope(role: string, teamId: string | null) {
  invitationRole.parse(role)
  const team = z.string().uuid().safeParse(teamId).success
  if (role === "team_manager") {
    if (!team) throw new Error("A team manager invitation requires a team")
  } else if (role === "captain") {
    if (!team) throw new Error("A captain invitation requires a team")
  } else if (teamId !== null) {
    throw new Error(`Team-scoped ${role} invitations are not supported yet`)
  }
}

export function invitationRecipientHint(email: string): string {
  const [name, domain] = email.split("@")
  return `${name.slice(0, 1)}***@${domain}`
}

export function invitationBaseUrl(): string {
  const configured = process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!configured && process.env.NODE_ENV === "production") throw new Error("Configure the invitation app URL before issuing invitations")
  const url = new URL(configured || "http://localhost:3001")
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("Invitation app URL must be a trusted origin (HTTPS in production)")
  }
  return url.origin
}
