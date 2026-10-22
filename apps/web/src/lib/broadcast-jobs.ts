import { randomUUID } from "node:crypto"
import {
  auditLogs, broadcastArchives, broadcastConnections, broadcastDestinations, broadcastJobs,
  broadcastSessions, db, matches,
} from "@mtk/database"
import {
  broadcastReconcileDecision,
  broadcastObservedFromProvider,
  buildProviderPlaybackUrls,
  parseProviderVideoId,
  type BroadcastDesiredState,
  type BroadcastObservedState,
  type BroadcastProvider,
} from "@mtk/contracts"
import { broadcastJobRetryDecision } from "@mtk/database/lib/broadcast-job-policy"
import { and, eq, sql } from "drizzle-orm"
import {
  BroadcastProviderError,
  endBroadcast,
  prepareBroadcast,
  reconcileBroadcast,
  startBroadcast,
  type BroadcastProviderObservation,
  type BroadcastProviderRequest,
} from "./broadcast-provider"
import {
  BroadcastCredentialError,
  broadcastCredentialsReady,
  broadcastIngestEncryptionReady,
  encryptBroadcastIngest,
  resolveBroadcastCredential,
} from "./broadcast-credentials"
import { broadcastJobKey, enqueueBroadcastJob } from "./broadcast-sessions"

/**
 * ENH-08-02: durable provider worker.
 *
 * The worker claims bounded jobs with SKIP LOCKED, then takes an exclusive
 * per-session lease. Provider HTTP runs AFTER both leases are held and BEFORE
 * any database write. Every settlement is fenced on the job lease; every
 * session write is fenced on its revision + session lease. A lost response is
 * retried through the same idempotency key and reconciled, never treated as a
 * second create/start.
 *
 * `BROADCAST_WORKER_READY` is the single enable switch. It must stay off until
 * the additive broadcast migration is applied and provider credentials are
 * provisioned. With no credential store or ingest-encryption key the worker
 * claims nothing, so a configuration error never burns retry attempts.
 */

export const broadcastWorkerEnabled = () => process.env.BROADCAST_WORKER_READY === "true"
export const BROADCAST_JOB_BATCH_LIMIT = 10
const SESSION_LEASE_SECONDS = 45

type ClaimedJob = {
  id: string
  tenant_id: string
  session_id: string
  action: "prepare" | "start" | "end" | "reconcile" | "archive"
  attempts: number
  max_attempts: number
  lease_owner: string
  payload: unknown
}

type WorkerSession = {
  id: string
  tenant_id: string
  match_id: string
  session_number: number
  provider: BroadcastProvider
  desired_state: BroadcastDesiredState
  observed_state: BroadcastObservedState
  provider_broadcast_id: string | null
  provider_stream_id: string | null
  playback_video_id: string | null
  playback_available: boolean
  ingest_secret_ref: string | null
  revision: number
  scheduled_start_at: Date | null
  started_at: Date | null
  ended_at: Date | null
  provider_metadata: unknown
  connection_id: string
  connection_status: "active" | "expired" | "revoked"
  credential_ref: string
  destination_external_id: string
  destination_kind: "channel" | "playlist" | "page"
  destination_name: string
}

export type BroadcastJobRunSummary = {
  enabled: boolean
  claimed: number
  prepared: number
  started: number
  ended: number
  reconciled: number
  retrying: number
  failed: number
  deadLettered: number
  fenced: number
}

const EMPTY_RUN: BroadcastJobRunSummary = {
  enabled: false, claimed: 0, prepared: 0, started: 0, ended: 0,
  reconciled: 0, retrying: 0, failed: 0, deadLettered: 0, fenced: 0,
}

function isAttached(metadata: unknown): boolean {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    && (metadata as { attached?: unknown }).attached === true
}

function safeMetadata(current: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const base = current !== null && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {}
  // Provider adapters return an allowlisted shape. This second allowlist keeps
  // a future adapter mistake from parking response bodies/keys in the row.
  const allowed = new Set([
    "provider", "attached", "broadcastStatus", "lifeCycleStatus", "liveBroadcastContent",
    "uploadStatus", "status", "permalinkUrl",
  ])
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(next)) {
    if (allowed.has(key) && (typeof value === "string" || typeof value === "boolean")) out[key] = value
  }
  return out
}

async function acquireSessionLease(
  sessionId: string,
  tenantId: string,
  leaseOwner: string,
): Promise<WorkerSession | null> {
  const rows = await db.execute(sql`UPDATE public.broadcast_sessions
    SET lease_owner = ${leaseOwner},
        lease_expires_at = now() + make_interval(secs => ${SESSION_LEASE_SECONDS}),
        updated_at = now()
    WHERE id = ${sessionId}::uuid AND tenant_id = ${tenantId}::uuid
      AND (lease_owner IS NULL OR lease_owner = ${leaseOwner}
        OR lease_expires_at IS NULL OR lease_expires_at <= now())
    RETURNING id, tenant_id, match_id, session_number, provider, desired_state, observed_state,
      provider_broadcast_id, provider_stream_id, playback_video_id, playback_available,
      ingest_secret_ref, revision, scheduled_start_at, started_at, ended_at, provider_metadata,
      connection_id`) as unknown as WorkerSession[]
  const session = rows[0]
  if (!session) return null
  const [joined] = await db.select({
    credentialRef: broadcastConnections.credentialRef,
    connectionStatus: broadcastConnections.status,
    destinationExternalId: broadcastDestinations.externalId,
    destinationKind: broadcastDestinations.kind,
    destinationName: broadcastDestinations.name,
  }).from(broadcastSessions)
    .innerJoin(broadcastConnections, and(
      eq(broadcastSessions.connectionId, broadcastConnections.id),
      eq(broadcastSessions.tenantId, broadcastConnections.tenantId),
    ))
    .innerJoin(broadcastDestinations, and(
      eq(broadcastSessions.destinationId, broadcastDestinations.id),
      eq(broadcastSessions.tenantId, broadcastDestinations.tenantId),
    ))
    .where(and(
      eq(broadcastSessions.id, session.id),
      eq(broadcastSessions.tenantId, session.tenant_id),
    ))
    .limit(1)
  if (!joined) return null
  return {
    ...session,
    credential_ref: joined.credentialRef,
    connection_status: joined.connectionStatus as WorkerSession["connection_status"],
    destination_external_id: joined.destinationExternalId,
    destination_kind: joined.destinationKind as WorkerSession["destination_kind"],
    destination_name: joined.destinationName,
  }
}

type SessionLeaseExecutor = {
  update: typeof db.update
}

async function releaseSessionLease(
  sessionId: string,
  tenantId: string,
  leaseOwner: string,
  executor: SessionLeaseExecutor = db,
) {
  await executor.update(broadcastSessions).set({
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(broadcastSessions.id, sessionId),
    eq(broadcastSessions.tenantId, tenantId),
    eq(broadcastSessions.leaseOwner, leaseOwner),
  ))
}

async function settleJob(input: {
  job: ClaimedJob
  leaseOwner: string
  state: "succeeded" | "failed" | "dead" | "pending"
  code: string
  nextAttemptAt?: Date
  sessionId?: string
  tenantId?: string
}) {
  return db.transaction(async tx => {
    const [settled] = await tx.update(broadcastJobs).set({
      state: input.state,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: input.state === "succeeded" ? null : input.code,
      nextAttemptAt: input.nextAttemptAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastJobs.id, input.job.id),
      eq(broadcastJobs.tenantId, input.job.tenant_id),
      eq(broadcastJobs.leaseOwner, input.leaseOwner),
    )).returning({ id: broadcastJobs.id })
    if (!settled) return false

    if (input.sessionId && input.tenantId) {
      await releaseSessionLease(input.sessionId, input.tenantId, input.leaseOwner, tx)
    }
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: input.job.tenant_id,
      actorId: null,
      actorRole: "broadcast_worker",
      method: "BROADCAST_JOB_SETTLED",
      path: `/api/cron/broadcast-jobs/${input.job.id}`,
      statusCode: input.state === "succeeded" ? "200" : "503",
      payload: {
        jobId: input.job.id,
        sessionId: input.job.session_id,
        action: input.job.action,
        state: input.state,
        code: input.code,
        attempts: input.job.attempts,
      },
    })
    return true
  })
}

function nextDesiredForObservation(input: {
  action: ClaimedJob["action"]
  desired: BroadcastDesiredState
  observed: BroadcastObservedState | null
}): BroadcastDesiredState {
  // An operator-requested ending stays ending until the provider is terminal.
  if (input.action === "end") {
    if (input.observed === "processing" || input.observed === "replay_ready" || input.observed === "ended") {
      return "ended"
    }
    return "ending"
  }
  // A terminal operator intent is never overwritten by a late observation.
  // `ending` is terminal for a reconcile/archive read; only the explicit end
  // job may advance it to ended.
  if (input.desired === "cancelled") return "cancelled"
  if (input.desired === "failed") return "failed"
  if (input.desired === "ended") return "ended"
  if (input.desired === "ending") return "ending"
  if (input.observed === "live") return "live"
  if (input.observed === "ready") return "ready"
  if (input.observed === "failed") return "failed"
  if (input.observed === "processing" || input.observed === "replay_ready" || input.observed === "ended") {
    return "ended"
  }
  if (input.action === "prepare" && input.observed === "provisioning") return "preparing"
  if (input.action === "start" && input.observed === "provisioning") return "starting"
  return input.desired
}

async function applyObservation(input: {
  job: ClaimedJob
  session: WorkerSession
  leaseOwner: string
  observation: BroadcastProviderObservation
}): Promise<{ updatedRevision: number | null; desired: BroadcastDesiredState; observed: BroadcastObservedState | null }> {
  const current = input.session
  const observed = input.observation.observed
  if (!observed) {
    // An unreadable/unknown provider status must not downgrade a previously
    // verified live badge or pretend the desired transition happened. Record
    // the unknown read and let the follow-up reconcile try again.
    const [unknown] = await db.update(broadcastSessions).set({
      lastErrorCode: "provider_state_unknown",
      revision: current.revision + 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastSessions.id, current.id),
      eq(broadcastSessions.tenantId, current.tenant_id),
      eq(broadcastSessions.revision, current.revision),
      eq(broadcastSessions.leaseOwner, input.leaseOwner),
    )).returning({ revision: broadcastSessions.revision })
    if (!unknown) {
      await releaseSessionLease(current.id, current.tenant_id, input.leaseOwner)
      return { updatedRevision: null, desired: current.desired_state, observed: null }
    }
    return { updatedRevision: unknown.revision, desired: current.desired_state, observed: null }
  }
  let desired = nextDesiredForObservation({
    action: input.job.action,
    desired: current.desired_state,
    observed,
  })
  // Terminal operator intent is not reopened by a late observation. An
  // explicit end job still reconciles its own ending state above.
  const terminalIntent = ["ended", "cancelled", "failed"].includes(current.desired_state)
    || (current.desired_state === "ending" && input.job.action !== "end")
  if (observed && input.job.action !== "prepare" && !terminalIntent) {
    const decision = broadcastReconcileDecision({ desired, observed })
    desired = decision.nextDesired
  }

  const providerBroadcastId = input.observation.providerBroadcastId ?? current.provider_broadcast_id
  const providerStreamId = input.observation.providerStreamId ?? current.provider_stream_id
  const playbackVideoId = input.observation.playbackVideoId ?? current.playback_video_id
  const playbackAvailable = observed === "live"
  let ingestSecretRef = current.ingest_secret_ref
  if (input.observation.ingest) {
    ingestSecretRef = encryptBroadcastIngest(current.id, input.observation.ingest)
  }
  const startedAt = input.observation.startedAt
    ?? (observed === "live" ? current.started_at ?? new Date() : current.started_at)
  const endedAt = input.observation.endedAt
    ?? (["processing", "replay_ready", "ended"].includes(observed ?? "")
      ? current.ended_at ?? new Date()
      : current.ended_at)

  const [updated] = await db.update(broadcastSessions).set({
    desiredState: desired,
    ...(observed ? { observedState: observed } : {}),
    providerBroadcastId,
    providerStreamId,
    playbackVideoId,
    playbackAvailable,
    ingestSecretRef,
    providerMetadata: safeMetadata(current.provider_metadata, input.observation.providerMetadata),
    startedAt,
    endedAt,
    lastErrorCode: observed ? null : "provider_state_unknown",
    revision: current.revision + 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(broadcastSessions.id, current.id),
    eq(broadcastSessions.tenantId, current.tenant_id),
    eq(broadcastSessions.revision, current.revision),
    eq(broadcastSessions.leaseOwner, input.leaseOwner),
  )).returning({ revision: broadcastSessions.revision })
  if (!updated) {
    await releaseSessionLease(current.id, current.tenant_id, input.leaseOwner)
    return { updatedRevision: null, desired, observed }
  }

  // Legacy compatibility: once the provider observes live, the old public path
  // can still embed the exact provider page. This is written from observation,
  // never from operator intent, and is cleared to ended when the provider ends.
  if (observed === "live" && playbackVideoId
    && desired !== "ending" && desired !== "ended" && desired !== "cancelled" && desired !== "failed") {
    const urls = buildProviderPlaybackUrls(current.provider, playbackVideoId)
    if (urls) {
      await db.update(matches).set({
        liveStreamUrl: urls.externalUrl,
        streamSource: current.provider,
        streamStatus: "live",
        updatedAt: new Date(),
      }).where(and(
        eq(matches.id, current.match_id),
        eq(matches.tenantId, current.tenant_id),
      ))
    }
  } else if (observed === "ended" || observed === "processing" || observed === "replay_ready") {
    await db.update(matches).set({
      streamStatus: "ended",
      updatedAt: new Date(),
    }).where(and(
      eq(matches.id, current.match_id),
      eq(matches.tenantId, current.tenant_id),
    ))
  }

  if (input.observation.archive) {
    const archive = input.observation.archive
    const providerVideoId = parseProviderVideoId(current.provider, archive.providerVideoId)
    if (providerVideoId) {
      await db.insert(broadcastArchives).values({
        tenantId: current.tenant_id,
        sessionId: current.id,
        providerVideoId,
        status: archive.status,
        durationSeconds: archive.durationSeconds,
        availableAt: archive.availableAt,
        retentionUntil: archive.retentionUntil,
        metadata: {},
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: broadcastArchives.sessionId,
        set: {
          providerVideoId,
          status: archive.status,
          durationSeconds: archive.durationSeconds,
          availableAt: archive.availableAt,
          retentionUntil: archive.retentionUntil,
          updatedAt: new Date(),
        },
      })
    }
  }

  return { updatedRevision: updated.revision, desired, observed }
}

async function scheduleReconcile(input: {
  session: WorkerSession
  revision: number
  desired: BroadcastDesiredState
  observed: BroadcastObservedState | null
  action: "reconcile" | "archive" | "end"
  delaySeconds: number
  polls: number
}) {
  if (input.polls >= 180) return
  if (input.desired === "failed" || input.desired === "cancelled" || input.desired === "ended") {
    if (input.action !== "archive") return
  }
  if (input.observed === "live" && input.action !== "end") return
  if (input.observed === "replay_ready") return
  // A ready broadcast waits for the operator's Start; polling it every ten
  // seconds would spend provider quota without changing the projection.
  if (input.observed === "ready" && input.desired === "ready" && input.action === "reconcile") return
  // A confirmed ended attachment has nothing left to poll. A managed ended
  // broadcast still uses the archive action to discover replay readiness.
  if (input.observed === "ended" && input.action === "reconcile") return
  if (input.observed && !["provisioning", "ready", "interrupted", "ending", "processing", "ended"].includes(input.observed)) {
    return
  }

  let delaySeconds = input.delaySeconds
  // An attached upcoming video should not be polled every ten seconds for hours.
  if (input.observed === "provisioning" && input.desired === "starting" && input.session.scheduled_start_at) {
    const scheduled = new Date(input.session.scheduled_start_at).getTime()
    if (Number.isFinite(scheduled)) {
      const until = scheduled - Date.now() - 5 * 60_000
      if (until > delaySeconds * 1_000) delaySeconds = Math.min(3_600, Math.round(until / 1_000))
    }
  }

  await db.transaction(async tx => {
    await enqueueBroadcastJob(tx, {
      tenantId: input.session.tenant_id,
      sessionId: input.session.id,
      action: input.action,
      idempotencyKey: broadcastJobKey(input.session.id, input.action, `v${input.revision}`),
      nextAttemptAt: new Date(Date.now() + delaySeconds * 1_000),
      payload: { reason: input.observed ?? "unknown", polls: input.polls + 1 },
    })
  })
}

function jobPolls(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0
  const value = (payload as { polls?: unknown }).polls
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 10_000
    ? value
    : 0
}

function publicTitle(session: WorkerSession): string {
  return `SSL live ${session.match_id.slice(0, 8)}`
}

function requestFor(input: {
  session: WorkerSession
  accessToken: string
  action: ClaimedJob["action"]
}): BroadcastProviderRequest {
  return {
    provider: input.session.provider,
    accessToken: input.accessToken,
    destinationExternalId: input.session.destination_external_id,
    destinationKind: input.session.destination_kind,
    // Archive/reconcile-after-end reads the video by id instead of the live
    // broadcast resource, so provider processing can become replay-ready.
    providerBroadcastId: input.action === "archive" ? null : input.session.provider_broadcast_id,
    providerStreamId: input.session.provider_stream_id,
    playbackVideoId: input.session.playback_video_id,
    marker: `ssl-session-${input.session.id}`,
    title: publicTitle(input.session),
    scheduledStartAt: input.session.scheduled_start_at,
  }
}

export async function processBroadcastJobs(now = new Date()): Promise<BroadcastJobRunSummary> {
  if (!broadcastWorkerEnabled()) return { ...EMPTY_RUN }
  // Both are deployment configuration, not a per-job failure. Claim nothing
  // until the operator has provisioned the secret store and ingest key.
  if (!broadcastCredentialsReady() || !broadcastIngestEncryptionReady()) {
    return { ...EMPTY_RUN, enabled: true }
  }

  // A worker that died on its final attempt becomes terminal, not leased
  // forever. Attempts are capped by the DB check. The affected session is
  // marked failed too, so the operator never sees a perpetual "starting" row.
  await db.execute(sql`WITH dead AS (
    UPDATE public.broadcast_jobs
    SET state = 'dead', lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = COALESCE(last_error_code, 'lease_expired'), updated_at = now()
    WHERE state = 'running' AND attempts >= max_attempts
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    RETURNING tenant_id, session_id, last_error_code
  )
  UPDATE public.broadcast_sessions s
  SET desired_state = 'failed',
      last_error_code = COALESCE(d.last_error_code, 'lease_expired'),
      revision = s.revision + 1,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  FROM dead d
  WHERE s.id = d.session_id AND s.tenant_id = d.tenant_id
    AND s.desired_state NOT IN ('ended', 'cancelled', 'failed')`)

  const leaseOwner = randomUUID()
  const claimedRows = await db.execute(sql`WITH due AS (
    SELECT j.id FROM public.broadcast_jobs j
    WHERE (j.state = 'pending'
      OR (j.state = 'running' AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= now())))
      AND j.attempts < j.max_attempts
      AND j.next_attempt_at <= now()
    ORDER BY j.next_attempt_at, j.id
    LIMIT ${BROADCAST_JOB_BATCH_LIMIT}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.broadcast_jobs j
  SET state = 'running', lease_owner = ${leaseOwner}, lease_expires_at = now() + interval '2 minutes',
      attempts = j.attempts + 1, updated_at = now()
  FROM due WHERE j.id = due.id
  RETURNING j.id, j.tenant_id, j.session_id, j.action, j.attempts, j.max_attempts, j.lease_owner, j.payload`)
  const claimed = claimedRows as unknown as ClaimedJob[]

  const summary: BroadcastJobRunSummary = { ...EMPTY_RUN, enabled: true, claimed: claimed.length }

  for (const job of claimed) {
    const sessionLease = `${leaseOwner}:${job.id}`
    const session = await acquireSessionLease(job.session_id, job.tenant_id, sessionLease)
    if (!session) {
      const decision = broadcastJobRetryDecision({
        attempts: job.attempts, maxAttempts: job.max_attempts, code: "session_lease_held", now,
      })
      const state = decision.state === "pending" ? "pending" : "failed"
      await settleJob({
        job, leaseOwner, state, code: "session_lease_held",
        nextAttemptAt: decision.state === "pending" ? decision.nextAttemptAt : undefined,
      })
      if (state === "pending") summary.retrying += 1
      else summary.failed += 1
      continue
    }

    const obsoleteStart = job.action === "start"
      && ["ending", "ended", "cancelled", "failed"].includes(session.desired_state)
    const obsoletePrepare = job.action === "prepare"
      && ["ended", "cancelled", "failed"].includes(session.desired_state)
    if (obsoleteStart || obsoletePrepare) {
      // The operator cancelled before this queued job ran. The explicit end
      // job (if any) owns provider output; a late Start/Prepare must not
      // resurrect the part or create an orphan provider object.
      await settleJob({
        job, leaseOwner, state: "succeeded", code: "operator_intent_obsolete",
        sessionId: session.id, tenantId: session.tenant_id,
      })
      summary.reconciled += 1
      continue
    }

    let outcome: BroadcastProviderObservation | null = null
    let failureCode: string | null = null
    let failurePartial: BroadcastProviderError["partial"] | null = null

    try {
      if (session.connection_status !== "active") {
        throw new BroadcastCredentialError(session.connection_status === "revoked"
          ? "credentials_revoked"
          : "credentials_expired")
      }
      const credential = resolveBroadcastCredential(session.credential_ref)
      const attached = isAttached(session.provider_metadata)
      const request = requestFor({
        session,
        accessToken: credential.accessToken,
        action: job.action,
      })
      const startedAlready = session.observed_state === "live" || session.desired_state === "live"
      const startObservedTerminal = job.action === "start"
        && (session.observed_state === "ended"
          || session.observed_state === "processing"
          || session.observed_state === "replay_ready"
          || session.observed_state === "failed")
      const endedAlready = session.observed_state === "ended"
        || session.observed_state === "processing"
        || session.observed_state === "replay_ready"
        || session.desired_state === "ended"
      if (job.action === "prepare") {
        if (attached) throw new BroadcastProviderError("invalid_request")
        outcome = await prepareBroadcast(request)
      } else if (startObservedTerminal) {
        outcome = await reconcileBroadcast(request)
      } else if (job.action === "start" && startedAlready) {
        outcome = await reconcileBroadcast(request)
      } else if (job.action === "end" && endedAlready) {
        outcome = await reconcileBroadcast(request)
      } else if (job.action === "start") {
        if (attached) {
          outcome = await reconcileBroadcast(request)
        } else if (job.attempts > 1) {
          // The previous start may have succeeded after its response was lost.
          // Observe first; only issue another transition if the provider still
          // says ready. This avoids treating "already live" as a refusal.
          const current = await reconcileBroadcast(request)
          outcome = current.observed === "ready"
            ? await startBroadcast(request)
            : current
        } else {
          outcome = await startBroadcast(request)
        }
      } else if (job.action === "end") {
        if (job.attempts > 1) {
          // Same lost-response discipline for end: never issue a duplicate
          // completion transition when the provider already ended.
          const current = await reconcileBroadcast(request)
          const terminal = current.observed === "processing"
            || current.observed === "replay_ready"
            || current.observed === "ended"
            || current.observed === "failed"
          outcome = terminal ? current : await endBroadcast(request)
        } else {
          outcome = await endBroadcast(request)
        }
      } else {
        outcome = await reconcileBroadcast(request)
      }
    } catch (error) {
      if (error instanceof BroadcastProviderError) {
        failureCode = error.code
        failurePartial = error.partial
      } else if (error instanceof BroadcastCredentialError) {
        failureCode = error.code
      } else {
        failureCode = "worker_error"
      }
    }

    if (failurePartial && (failurePartial.providerBroadcastId || failurePartial.providerStreamId
      || failurePartial.ingest)) {
      // Preserve a provider object created before a later step failed. The next
      // prepare adopts these ids instead of creating a duplicate broadcast.
      const [saved] = await db.update(broadcastSessions).set({
        ...(failurePartial.providerBroadcastId !== undefined
          ? { providerBroadcastId: failurePartial.providerBroadcastId } : {}),
        ...(failurePartial.providerStreamId !== undefined
          ? { providerStreamId: failurePartial.providerStreamId } : {}),
        ...(failurePartial.ingest
          ? { ingestSecretRef: encryptBroadcastIngest(session.id, failurePartial.ingest) } : {}),
        revision: session.revision + 1,
        updatedAt: now,
      }).where(and(
        eq(broadcastSessions.id, session.id),
        eq(broadcastSessions.tenantId, session.tenant_id),
        eq(broadcastSessions.revision, session.revision),
        eq(broadcastSessions.leaseOwner, sessionLease),
      )).returning({ revision: broadcastSessions.revision })
      if (saved) session.revision = saved.revision
    }

    if (!outcome) {
      const code = failureCode ?? "worker_error"
      const decision = broadcastJobRetryDecision({
        attempts: job.attempts, maxAttempts: job.max_attempts, code, now,
      })
      const state = decision.state === "succeeded"
        ? "succeeded"
        : decision.state === "failed"
          ? "failed"
          : decision.state === "dead_lettered"
            ? "dead"
            : "pending"
      await settleJob({
        job, leaseOwner, state, code,
        nextAttemptAt: decision.state === "pending" ? decision.nextAttemptAt : undefined,
        sessionId: session.id,
        tenantId: session.tenant_id,
      })
      if (state === "failed" || state === "dead") {
        // Both a permanent refusal and exhausted retries leave the session
        // unable to progress. Record that honestly instead of showing a
        // perpetually "starting" request.
        // The lease was just released, so a revision fence (not a lease fence)
        // prevents this failure from overwriting a newer observation.
        await db.update(broadcastSessions).set({
          desiredState: "failed",
          lastErrorCode: code,
          revision: session.revision + 1,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }).where(and(
          eq(broadcastSessions.id, session.id),
          eq(broadcastSessions.tenantId, session.tenant_id),
          eq(broadcastSessions.revision, session.revision),
        ))
        if (code === "credentials_expired") {
          await db.update(broadcastConnections).set({
            status: "expired",
            updatedAt: now,
          }).where(and(
            eq(broadcastConnections.id, session.connection_id),
            eq(broadcastConnections.tenantId, session.tenant_id),
          ))
        }
        summary.failed += state === "failed" ? 1 : 0
        summary.deadLettered += state === "dead" ? 1 : 0
      } else {
        summary.retrying += 1
      }
      continue
    }

    const applied = await applyObservation({ job, session, leaseOwner: sessionLease, observation: outcome })
    if (applied.updatedRevision === null) {
      // The session was revised by another worker. Record the provider
      // observation as a succeeded job and let one reconcile own the truth.
      await settleJob({ job, leaseOwner, state: "succeeded", code: "session_fenced" })
      await db.transaction(async tx => {
        await enqueueBroadcastJob(tx, {
          tenantId: session.tenant_id,
          sessionId: session.id,
          action: "reconcile",
          idempotencyKey: broadcastJobKey(session.id, "reconcile", `fenced-${job.id}`),
          payload: { reason: "session_fenced" },
        })
      })
      summary.fenced += 1
      continue
    }

    const settled = await settleJob({ job, leaseOwner, state: "succeeded", code: "succeeded" })
    if (!settled) {
      summary.fenced += 1
      continue
    }

    if (job.action === "prepare") summary.prepared += 1
    else if (job.action === "start") summary.started += 1
    else if (job.action === "end") summary.ended += 1
    else summary.reconciled += 1

    const retryEnd = job.action === "end"
      && ["live", "interrupted", "ending"].includes(outcome.observed ?? "")
    const archive = outcome.observed === "ended" || outcome.observed === "processing"
    await scheduleReconcile({
      session,
      revision: applied.updatedRevision,
      desired: applied.desired,
      observed: outcome.observed,
      action: retryEnd ? "end" : archive ? "archive" : "reconcile",
      delaySeconds: outcome.observed === "processing" ? 30 : 10,
      polls: jobPolls(job.payload),
    })
  }

  return summary
}

/**
 * Reconcile a provider status that arrived via a webhook/direct read. Still
 * writes through the same revision/lease fences.
 */
export async function observeBroadcastProviderStatus(input: {
  provider: BroadcastProvider
  rawStatus: string
}): Promise<BroadcastObservedState | null> {
  return broadcastObservedFromProvider(input.provider, input.rawStatus)
}
