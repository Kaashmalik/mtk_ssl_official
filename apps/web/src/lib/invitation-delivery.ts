import { db, userInvites, type InvitationEmailState } from "@mtk/database"
import { eq } from "drizzle-orm"
import { z } from "zod"

/**
 * Provider delivery events we persist. `email.sent` / `email.delivery_delayed`
 * are intentionally ignored: the send path already records `provider_accepted`,
 * and a delayed event is not a terminal outcome.
 */
const RESEND_EVENT_STATE: Record<string, InvitationEmailState> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
}

/** Map a Resend event type to a persisted state, or `null` when it is ignored. */
export function resendEventToState(type: string): InvitationEmailState | null {
  return RESEND_EVENT_STATE[type] ?? null
}

type ResendTag = { name?: unknown; value?: unknown }

/**
 * The invitation id is carried on the outgoing email as a `invite_id` tag so a
 * webhook event can be correlated without trusting an email address. Only a
 * well-formed UUID is accepted.
 */
export function extractInviteId(data: unknown): string | null {
  const tags = (data as { tags?: unknown } | null | undefined)?.tags
  if (!Array.isArray(tags)) return null
  for (const tag of tags as ResendTag[]) {
    if (tag?.name === "invite_id" && typeof tag.value === "string" && z.string().uuid().safeParse(tag.value).success) {
      return tag.value
    }
  }
  return null
}

/**
 * Record a signature-verified provider delivery event against its invitation.
 *
 * The webhook is a trusted server-to-server call and carries no tenant context,
 * so the update targets the invitation's unique id. Ignored events and unknown
 * invitations return `applied: false` rather than throwing, so a provider retry
 * of an already-processed event is a harmless no-op.
 */
export async function applyInvitationDeliveryEvent(
  event: { type?: string | null; data?: unknown },
): Promise<{ applied: boolean; inviteId: string | null; state: InvitationEmailState | null }> {
  const state = resendEventToState(event.type ?? "")
  if (!state) return { applied: false, inviteId: null, state: null }
  const inviteId = extractInviteId(event.data)
  if (!inviteId) return { applied: false, inviteId: null, state }
  const [updated] = await db.update(userInvites).set({ emailState: state })
    .where(eq(userInvites.id, inviteId))
    .returning({ id: userInvites.id })
  return { applied: Boolean(updated), inviteId, state }
}
