import { randomUUID } from "node:crypto"
import { db, invitationEmailJobs, userInvites } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { encryptInvitationMail, decryptInvitationMail, invitationQueueKeyId } from "./invitation-mail-crypto"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
const mailSchema = z.object({ to: z.string().email(), subject: z.string().max(500), text: z.string().max(20000) }).strict()
const binding = (tenant: string, invite: string, hash: string) => JSON.stringify([tenant, invite, hash])
export const invitationQueueEnabled = () => process.env.INVITATION_EMAIL_QUEUE_READY === "true"

/** Must be called INSIDE the invitation issue/token-rotation transaction. */
export async function enqueueInvitationEmail(tx: Tx, input: {
  tenantId: string; inviteId: string; tokenHash: string; to: string; subject: string; text: string
}) {
  const keyId = invitationQueueKeyId()
  const message = mailSchema.parse({ to: input.to, subject: input.subject, text: input.text })
  await tx.insert(invitationEmailJobs).values({ tenantId: input.tenantId, inviteId: input.inviteId,
    tokenHash: input.tokenHash, keyId,
    encryptedMessage: encryptInvitationMail(message, binding(input.tenantId, input.inviteId, input.tokenHash)) })
  await tx.update(userInvites).set({ emailState: "queued", emailAttemptedAt: new Date(),
    emailAttemptCount: sql`${userInvites.emailAttemptCount} + 1` })
    .where(and(eq(userInvites.id, input.inviteId), eq(userInvites.tenantId, input.tenantId), eq(userInvites.tokenHash, input.tokenHash)))
}

export function invitationRetryDelay(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 8) throw new Error("Invalid invitation dispatch attempt")
  return [5, 30, 120, 600, 1800, 3600, 3600, 3600][attempt - 1] * 1000
}

type Job = { id: string; tenant_id: string; invite_id: string; token_hash: string;
  encrypted_message: string; key_id: string; attempts: number }

/** Current invitation, league and issuer authority. Obsolete secret payloads are scrubbed. */
const liveInvite = sql`EXISTS (SELECT 1 FROM public.user_invites i
  JOIN public.tenants t ON t.id = i.tenant_id AND t.is_active = true
  JOIN public.users u ON u.id = i.invited_by AND u.is_active = true
  JOIN public.user_tenant_roles m ON m.user_id = u.id AND m.tenant_id = t.id
    AND m.role = 'league_owner' AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > now())
  WHERE i.id = j.invite_id AND i.tenant_id = j.tenant_id AND i.token_hash = j.token_hash
    AND i.status = 'pending' AND i.expires_at > now())`

/** Atomic bounded leases; provider HTTP is outside locks; stale workers cannot settle a new lease. */
export async function processInvitationEmailJobs() {
  if (!invitationQueueEnabled()) return { enabled: false, claimed: 0, accepted: 0, retrying: 0, deadLettered: 0 }
  const keyId = invitationQueueKeyId()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) throw new Error("Invitation email provider not configured")
  await db.execute(sql`UPDATE public.invitation_email_jobs j SET state = 'cancelled', encrypted_message = NULL,
    resolved_at = now(), lease_token = NULL WHERE state IN ('pending','leased') AND NOT (${liveInvite})`)
  // A final attempt whose worker crashed must become terminal, not remain leased forever.
  await db.execute(sql`UPDATE public.invitation_email_jobs SET state = 'dead_lettered', encrypted_message = NULL,
    resolved_at = now(), lease_token = NULL, last_error = 'network_unknown'
    WHERE state IN ('pending','leased') AND attempts >= 8 AND next_attempt_at <= now()`)
  const lease = randomUUID()
  const rows = await db.execute(sql`WITH due AS (
    SELECT j.id FROM public.invitation_email_jobs j
    WHERE j.state IN ('pending','leased') AND j.attempts < 8 AND j.next_attempt_at <= now()
      AND j.key_id = ${keyId} AND ${liveInvite}
    ORDER BY j.next_attempt_at, j.id LIMIT 5 FOR UPDATE SKIP LOCKED
  ) UPDATE public.invitation_email_jobs j SET state = 'leased', lease_token = ${lease}::uuid,
    attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
    FROM due WHERE j.id = due.id RETURNING j.*`)
  const jobs = rows as unknown as Job[]
  const result = { enabled: true, claimed: jobs.length, accepted: 0, retrying: 0, deadLettered: 0 }
  for (const job of jobs) {
    let accepted = false
    let permanent = false
    let failure: "provider_rejected" | "network_unknown" | "decrypt_failed" = "decrypt_failed"
    try {
      const mail = mailSchema.parse(decryptInvitationMail(job.encrypted_message, binding(job.tenant_id, job.invite_id, job.token_hash)))
      failure = "network_unknown"
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `invitation-job/${job.id}` },
        body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "SSL <onboarding@ssl.mtkcodex.site>",
          to: mail.to, subject: mail.subject, text: mail.text, tags: [{ name: "invite_id", value: job.invite_id }] }),
      })
      accepted = response.ok
      if (!accepted) {
        permanent = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)
        failure = permanent ? "provider_rejected" : "network_unknown"
      }
    } catch {
      permanent = failure === "decrypt_failed"
      // Never log provider bodies, email addresses, ciphertext or invitation links.
    }
    const dead = !accepted && (permanent || job.attempts >= 8)
    const state = accepted ? "provider_accepted" : dead ? "dead_lettered" : "pending"
    const settled = await db.transaction(async tx => {
      const [changed] = await tx.update(invitationEmailJobs).set({ state, leaseToken: null,
        lastError: accepted ? null : failure,
        ...(accepted || dead ? { encryptedMessage: null, resolvedAt: new Date() } : {}),
        nextAttemptAt: new Date(Date.now() + invitationRetryDelay(job.attempts)),
      }).where(and(eq(invitationEmailJobs.id, job.id), eq(invitationEmailJobs.leaseToken, lease), eq(invitationEmailJobs.state, "leased")))
        .returning({ id: invitationEmailJobs.id })
      if (!changed) return false
      await tx.update(userInvites).set({ emailState: accepted ? "provider_accepted" : dead ? "dead_lettered" : "retry_scheduled" })
        .where(and(eq(userInvites.id, job.invite_id), eq(userInvites.tenantId, job.tenant_id), eq(userInvites.tokenHash, job.token_hash),
          sql`COALESCE(${userInvites.emailState}, '') NOT IN ('delivered','bounced','complained')`))
      return true
    })
    if (settled) {
      if (accepted) result.accepted++
      else if (dead) result.deadLettered++
      else result.retrying++
    }
  }
  return result
}
