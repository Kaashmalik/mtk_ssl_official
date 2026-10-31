import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import {
  db, mediaCleanupJobs, mediaQuotas, mediaUploadSessions,
} from "@mtk/database"
import {
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  mediaCleanupRetryDelayMs,
  type MediaKind,
} from "./media-policy"
import { cloudinaryConfig, cloudinaryResourceType, type CloudinaryConfig } from "./media-provider"

/**
 * ENH-07-03: durable provider destruction and expiry reconciliation.
 *
 * A tombstone is a record, not a removal. Delete/expiry/quarantine writes the
 * asset identity into `media_cleanup_jobs` in the SAME transaction that hides
 * the asset; provider HTTP runs later in the bounded worker. Jobs are leased
 * with SKIP LOCKED and every settlement is fenced on its lease token, so two
 * replicas cannot both claim a destruction as done.
 *
 * A provider delete is idempotent: Cloudinary answers 200 with `not_found`
 * for an already-absent public id. That is a successful destruction, not an
 * outage; network/5xx/429 stay retryable and auth/4xx are permanent failures.
 */

export type MediaCleanupAction = "destroy_provider_asset" | "invalidate_delivery"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function enqueueMediaCleanupJobs(
  tx: Tx,
  input: {
    tenantId: string
    assetId: string | null
    provider?: string
    providerPublicId: string
    providerResourceType: string
    actions: readonly MediaCleanupAction[]
  },
): Promise<number> {
  if (input.actions.length === 0) return 0
  const rows = await tx.insert(mediaCleanupJobs)
    .values(input.actions.map(action => ({
      tenantId: input.tenantId,
      assetId: input.assetId,
      provider: input.provider ?? "cloudinary",
      providerPublicId: input.providerPublicId,
      providerResourceType: input.providerResourceType,
      action,
    })))
    .onConflictDoNothing()
    .returning({ id: mediaCleanupJobs.id })
  return rows.length
}

export type MediaExpirySummary = {
  expiredSessions: number
  cleanupJobsQueued: number
}

/**
 * Release reservations whose session expired without a finalize. The provider
 * may still hold a partial/complete object, so destruction is queued by public
 * id even though no asset row exists (orphan-safe identity).
 */
export async function expireStaleMediaUploadSessions(
  now = new Date(),
  limit = 50,
): Promise<MediaExpirySummary> {
  return db.transaction(async tx => {
    const sessions = await tx
      .select({
        id: mediaUploadSessions.id,
        tenantId: mediaUploadSessions.tenantId,
        kind: mediaUploadSessions.kind,
        provider: mediaUploadSessions.provider,
        providerPublicId: mediaUploadSessions.providerPublicId,
        reservedBytes: mediaUploadSessions.reservedBytes,
      })
      .from(mediaUploadSessions)
      .where(and(
        eq(mediaUploadSessions.state, "reserved"),
        lte(mediaUploadSessions.expiresAt, now),
      ))
      .orderBy(asc(mediaUploadSessions.expiresAt))
      .for("update", { skipLocked: true })
      .limit(limit)
    if (sessions.length === 0) return { expiredSessions: 0, cleanupJobsQueued: 0 }

    const byTenant = new Map<string, { reservedBytes: number; sessions: typeof sessions }>()
    for (const session of sessions) {
      const bucket = byTenant.get(session.tenantId) ?? { reservedBytes: 0, sessions: [] }
      bucket.reservedBytes += session.reservedBytes
      bucket.sessions.push(session)
      byTenant.set(session.tenantId, bucket)
    }

    let cleanupJobsQueued = 0
    // Deterministic tenant order keeps concurrent sweeps from deadlocking on
    // quota rows; session rows are already SKIP LOCKED.
    for (const tenantId of [...byTenant.keys()].sort()) {
      const bucket = byTenant.get(tenantId)!
      const [quota] = await tx
        .select({ reservedBytes: mediaQuotas.reservedBytes })
        .from(mediaQuotas)
        .where(eq(mediaQuotas.tenantId, tenantId))
        .for("update")
        .limit(1)
      if (quota) {
        await tx.update(mediaQuotas)
          .set({
            reservedBytes: Math.max(0, quota.reservedBytes - bucket.reservedBytes),
            updatedAt: now,
          })
          .where(eq(mediaQuotas.tenantId, tenantId))
      }
      for (const session of bucket.sessions) {
        cleanupJobsQueued += await enqueueMediaCleanupJobs(tx, {
          tenantId,
          assetId: null,
          provider: session.provider,
          providerPublicId: session.providerPublicId,
          providerResourceType: cloudinaryResourceType(session.kind as MediaKind),
          actions: ["destroy_provider_asset", "invalidate_delivery"],
        })
      }
    }

    await tx.update(mediaUploadSessions)
      .set({ state: "expired", finalizedAt: now })
      .where(inArray(mediaUploadSessions.id, sessions.map(session => session.id)))

    return { expiredSessions: sessions.length, cleanupJobsQueued }
  })
}

export const mediaCleanupEnabled = () => process.env.MEDIA_CLEANUP_READY === "true"

/** One bounded claim per run; cron cadence can exceed the batch size. */
export const MEDIA_CLEANUP_BATCH_LIMIT = 20

type ClaimedJob = {
  id: string
  tenant_id: string
  asset_id: string | null
  provider: string
  provider_public_id: string
  provider_resource_type: string
  action: MediaCleanupAction
  attempts: number
}

export type MediaCleanupRunSummary = {
  enabled: boolean
  claimed: number
  destroyed: number
  retrying: number
  failed: number
  deadLettered: number
}

export async function processMediaCleanupJobs(now = new Date()): Promise<MediaCleanupRunSummary> {
  if (!mediaCleanupEnabled()) {
    return { enabled: false, claimed: 0, destroyed: 0, retrying: 0, failed: 0, deadLettered: 0 }
  }
  // An enabled worker without provider credentials must not burn retry
  // attempts against a configuration error. Leave every job pending.
  const config = cloudinaryConfig()
  if (!config) {
    return { enabled: true, claimed: 0, destroyed: 0, retrying: 0, failed: 0, deadLettered: 0 }
  }

  // A worker that died on its final attempt must become terminal instead of
  // staying leased forever.
  await db.execute(sql`UPDATE public.media_cleanup_jobs
    SET state = 'dead_lettered', lease_token = NULL, resolved_at = now(),
        last_error = COALESCE(last_error, 'lease_expired')
    WHERE state = 'leased' AND attempts >= ${MEDIA_CLEANUP_MAX_ATTEMPTS}
      AND next_attempt_at <= now()`)

  const lease = randomUUID()
  const jobs = await db.execute(sql`WITH due AS (
    SELECT j.id FROM public.media_cleanup_jobs j
    WHERE j.state IN ('pending','leased')
      AND j.attempts < ${MEDIA_CLEANUP_MAX_ATTEMPTS}
      AND j.next_attempt_at <= now()
    ORDER BY j.next_attempt_at, j.id
    LIMIT ${MEDIA_CLEANUP_BATCH_LIMIT}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.media_cleanup_jobs j
  SET state = 'leased', lease_token = ${lease}::uuid,
      attempts = j.attempts + 1,
      next_attempt_at = now() + interval '2 minutes'
  FROM due WHERE j.id = due.id
  RETURNING j.*`) as unknown as ClaimedJob[]

  const summary: MediaCleanupRunSummary = {
    enabled: true, claimed: jobs.length, destroyed: 0, retrying: 0, failed: 0, deadLettered: 0,
  }
  if (jobs.length === 0) return summary

  for (const job of jobs) {
    let result: CleanupOutcome
    if (job.action === "invalidate_delivery") {
      // The tombstone/withdrawal is already committed by the caller. Private
      // (`authenticated`) originals are only reachable through signed URLs that
      // the application mints after its publication gate and that expire within
      // MEDIA_PRIVATE_DELIVERY_TTL_SECONDS, so withdrawal needs no provider
      // call; destruction is the separate `destroy_provider_asset` job.
      result = { outcome: "destroyed" }
    } else if (job.action === "destroy_provider_asset") {
      result = await destroyProviderAsset(config, job)
    } else {
      result = { outcome: "failed", reason: "unknown_action" }
    }

    const exhausted = result.outcome === "retry" && job.attempts >= MEDIA_CLEANUP_MAX_ATTEMPTS
    const state = result.outcome === "destroyed"
      ? "provider_destroyed"
      : result.outcome === "failed"
        ? "failed"
        : exhausted
          ? "dead_lettered"
          : "pending"
    const resolved = result.outcome !== "retry" || exhausted
    const lastError = "reason" in result ? result.reason : null

    const [settled] = await db.update(mediaCleanupJobs)
      .set({
        state,
        leaseToken: null,
        lastError,
        resolvedAt: resolved ? now : null,
        nextAttemptAt: new Date(now.getTime() + mediaCleanupRetryDelayMs(job.attempts)),
      })
      // Lease fencing: a stale worker cannot settle a re-claimed attempt.
      .where(and(
        eq(mediaCleanupJobs.id, job.id),
        eq(mediaCleanupJobs.leaseToken, lease),
        eq(mediaCleanupJobs.state, "leased"),
      ))
      .returning({ id: mediaCleanupJobs.id })
    if (!settled) continue

    if (state === "provider_destroyed") summary.destroyed += 1
    else if (state === "failed") summary.failed += 1
    else if (state === "dead_lettered") summary.deadLettered += 1
    else summary.retrying += 1
  }
  return summary
}

type CleanupOutcome =
  | { outcome: "destroyed" }
  | { outcome: "retry"; reason: string }
  | { outcome: "failed"; reason: string }

async function destroyProviderAsset(
  config: CloudinaryConfig,
  job: ClaimedJob,
): Promise<CleanupOutcome> {
  if (job.provider !== "cloudinary") return { outcome: "failed", reason: "unknown_provider" }
  const publicId = encodeURIComponent(job.provider_public_id)
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/resources/${encodeURIComponent(job.provider_resource_type)}/upload?public_ids=${publicId}&invalidate=true`

  let response: Response
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
  } catch {
    return { outcome: "retry", reason: "network_unknown" }
  }

  // Already absent is success for an idempotent destruction.
  if (response.status === 404) return { outcome: "destroyed" }
  if (response.status === 401 || response.status === 403) {
    return { outcome: "failed", reason: `provider_auth_${response.status}` }
  }
  if (response.status === 400 || response.status === 422) {
    return { outcome: "failed", reason: `provider_refused_${response.status}` }
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { outcome: "retry", reason: `provider_http_${response.status}` }
  }
  if (!response.ok) return { outcome: "retry", reason: `provider_http_${response.status}` }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { outcome: "retry", reason: "provider_invalid_response" }
  }
  const deleted = (body as { deleted?: Record<string, unknown> } | null)?.deleted
  const verdict = deleted?.[job.provider_public_id]
  if (typeof verdict !== "string") {
    return { outcome: "retry", reason: "provider_verdict_missing" }
  }
  if (verdict === "deleted" || verdict === "not_found") return { outcome: "destroyed" }
  if (verdict === "error") return { outcome: "retry", reason: "provider_delete_error" }
  return { outcome: "retry", reason: `provider_verdict_${verdict.slice(0, 40)}` }
}
