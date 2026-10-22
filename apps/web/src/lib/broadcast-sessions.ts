import { randomUUID } from "node:crypto"
import {
  auditLogs, broadcastConnections, broadcastDestinations, broadcastJobs, broadcastSessions,
  checkPlanFeature, db, matches, membershipGrantsAccess, tenants, userTenantRoles, users,
  type PlanKey,
} from "@mtk/database"
import {
  broadcastDestinationDecision,
  broadcastPrepareCommandSchema,
  parseProviderVideoId,
  type BroadcastControlData,
  type BroadcastDestinationOption,
  type BroadcastSessionSummary,
} from "@mtk/contracts"
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { decryptBroadcastIngest } from "./broadcast-credentials"

/**
 * ENH-08-01/02: operator commands for the verified broadcast plane.
 *
 * A command records intent and enqueues a durable job in the SAME transaction.
 * No provider call happens here. Attach-existing creates a session that remains
 * unverified until the worker observes the provider; Prepare creates a session
 * that remains provisioning until the provider confirms readiness. Neither
 * path writes `matches.stream_status = live`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const broadcastControlEnabled = () => process.env.BROADCAST_CONTROL_READY === "true"

function assertBroadcastControlEnabled() {
  if (!broadcastControlEnabled()) throw new Error("Verified broadcast controls are not enabled")
}

export function broadcastJobKey(sessionId: string, action: string, discriminator?: string): string {
  return `broadcast:${sessionId}:${action}${discriminator ? `:${discriminator}` : ""}`.slice(0, 200)
}

export async function enqueueBroadcastJob(
  tx: Tx,
  input: {
    tenantId: string
    sessionId: string
    action: "prepare" | "start" | "end" | "reconcile" | "archive"
    idempotencyKey: string
    payload?: Record<string, unknown>
    nextAttemptAt?: Date
    maxAttempts?: number
  },
): Promise<boolean> {
  const [row] = await tx.insert(broadcastJobs)
    .values({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      nextAttemptAt: input.nextAttemptAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 8,
    })
    .onConflictDoNothing({
      target: [broadcastJobs.tenantId, broadcastJobs.idempotencyKey],
    })
    .returning({ id: broadcastJobs.id })
  return Boolean(row)
}

async function lockMatch(tx: Tx, tenantId: string, matchId: string) {
  await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
    WHERE ${and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))} FOR UPDATE`)
  const match = await tx.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
  })
  if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
  return match
}

async function assertBroadcastOwner(tx: Tx, clerkId: string, tenantId: string) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: broadcast management account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const [actor] = await tx.select({ id: users.id, isActive: users.isActive })
    .from(users).where(eq(users.id, initial.id)).limit(1)
  const [league] = await tx.select({ id: tenants.id, isActive: tenants.isActive, plan: tenants.plan })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const [member] = await tx.select({
    userId: userTenantRoles.userId,
    tenantId: userTenantRoles.tenantId,
    role: userTenantRoles.role,
    status: userTenantRoles.status,
    expiresAt: userTenantRoles.expiresAt,
  }).from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!actor || actor.id !== initial.id || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId
    || !membershipGrantsAccess(member) || member.role !== "league_owner") {
    throw new Error("Forbidden: only the league owner can manage broadcasts")
  }
  return { actor, league, member }
}

async function readDestination(
  tx: Tx,
  tenantId: string,
  destinationId: string,
  requestedProvider?: "youtube" | "facebook",
) {
  const [row] = await tx.select({
    id: broadcastDestinations.id,
    tenantId: broadcastDestinations.tenantId,
    connectionId: broadcastDestinations.connectionId,
    provider: broadcastDestinations.provider,
    externalId: broadcastDestinations.externalId,
    name: broadcastDestinations.name,
    kind: broadcastDestinations.kind,
    isActive: broadcastDestinations.isActive,
    connectionTenantId: broadcastConnections.tenantId,
    connectionProvider: broadcastConnections.provider,
    connectionStatus: broadcastConnections.status,
    connectionExpiresAt: broadcastConnections.expiresAt,
  }).from(broadcastDestinations)
    .innerJoin(broadcastConnections, and(
      eq(broadcastDestinations.connectionId, broadcastConnections.id),
      eq(broadcastDestinations.tenantId, broadcastConnections.tenantId),
    ))
    .where(and(
      eq(broadcastDestinations.id, destinationId),
      eq(broadcastDestinations.tenantId, tenantId),
    ))
    .limit(1)
  if (!row) throw new Error("Broadcast destination not found")
  const connectionExpired = row.connectionExpiresAt !== null
    && row.connectionExpiresAt.getTime() <= Date.now()
  const decision = broadcastDestinationDecision({
    requestTenantId: tenantId,
    connectionTenantId: row.connectionTenantId,
    connectionProvider: row.connectionProvider as "youtube" | "facebook",
    destinationProvider: row.provider as "youtube" | "facebook",
    connectionStatus: connectionExpired
      ? "expired"
      : row.connectionStatus as "active" | "expired" | "revoked",
    destinationActive: row.isActive,
    destinationKind: row.kind as "channel" | "playlist" | "page",
    provider: requestedProvider ?? row.provider as "youtube" | "facebook",
  })
  if (!decision.allowed) throw new Error(`Broadcast destination refused: ${decision.reason}`)
  return row
}

async function nextSessionNumber(tx: Tx, matchId: string): Promise<number> {
  const [last] = await tx.select({ sessionNumber: broadcastSessions.sessionNumber })
    .from(broadcastSessions)
    .where(eq(broadcastSessions.matchId, matchId))
    .orderBy(desc(broadcastSessions.sessionNumber))
    .limit(1)
  return (last?.sessionNumber ?? 0) + 1
}

function assertBroadcastableMatch(status: string) {
  if (!["scheduled", "toss", "live", "innings_break"].includes(status)) {
    throw new Error("A broadcast cannot be prepared for an ended match")
  }
}

async function assertNoActiveBroadcast(tx: Tx, tenantId: string, matchId: string) {
  const [active] = await tx.select({ id: broadcastSessions.id })
    .from(broadcastSessions)
    .where(and(
      eq(broadcastSessions.tenantId, tenantId),
      eq(broadcastSessions.matchId, matchId),
      or(
        inArray(broadcastSessions.desiredState, [
          "preparing", "ready", "starting", "live", "ending",
        ]),
        // A failed/ended intent never excuses a provider that is still live
        // or interrupted: a second part must not start until it is stopped.
        inArray(broadcastSessions.observedState, ["live", "interrupted"]),
      ),
    ))
    .limit(1)
  if (active) throw new Error("End the current broadcast part before preparing another")
}

async function auditBroadcast(
  tx: Tx,
  input: {
    tenantId: string
    actorId: string
    actorRole: string
    path: string
    method: string
    payload: Record<string, unknown>
  },
) {
  await tx.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    method: input.method,
    path: input.path,
    statusCode: "200",
    payload: input.payload,
  })
}

export type BroadcastCommandResult = {
  sessionId: string
  sessionNumber: number
  desiredState: string
  observedState: string
}

/**
 * Prepare a new provider broadcast through a league-owned destination. The
 * provider is not contacted here; the prepare job is the only caller.
 */
export async function prepareBroadcastSession(
  clerkId: string,
  tenantId: string,
  matchId: string,
  destinationId: string,
): Promise<BroadcastCommandResult> {
  assertBroadcastControlEnabled()
  const command = broadcastPrepareCommandSchema.parse({ destinationId })
  return db.transaction(async tx => {
    const match = await lockMatch(tx, tenantId, matchId)
    const { actor, league, member } = await assertBroadcastOwner(tx, clerkId, tenantId)
    assertBroadcastableMatch(match.status)
    checkPlanFeature({ plan: league.plan as PlanKey, feature: "liveStreaming", label: "Live streaming" })
    await assertNoActiveBroadcast(tx, tenantId, matchId)

    const destination = await readDestination(tx, tenantId, command.destinationId)
    const sessionNumber = await nextSessionNumber(tx, matchId)
    const [session] = await tx.insert(broadcastSessions).values({
      tenantId,
      matchId,
      connectionId: destination.connectionId,
      destinationId: destination.id,
      provider: destination.provider,
      sessionNumber,
      desiredState: "preparing",
      observedState: "unconfigured",
      idempotencyKey: `match:${matchId}:session:${sessionNumber}`,
      scheduledStartAt: match.scheduledDate,
      createdBy: actor.id,
    }).returning()
    if (!session) throw new Error("Broadcast session could not be created")

    await enqueueBroadcastJob(tx, {
      tenantId,
      sessionId: session.id,
      action: "prepare",
      idempotencyKey: broadcastJobKey(session.id, "prepare"),
      payload: { destinationId: destination.id },
    })
    await auditBroadcast(tx, {
      tenantId,
      actorId: actor.id,
      actorRole: member.role,
      method: "BROADCAST_PREPARE_REQUESTED",
      path: `/dashboard/matches/${matchId}`,
      payload: {
        matchId,
        sessionId: session.id,
        destinationId: destination.id,
        provider: destination.provider,
      },
    })
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      desiredState: session.desiredState,
      observedState: session.observedState,
    }
  })
}

/**
 * Attach an existing provider video. The URL is parsed with the same exact
 * allowlist as public playback, but attachment is still only a request to
 * reconcile: a URL is not proof that the provider says live.
 */
export async function attachBroadcastSession(
  clerkId: string,
  tenantId: string,
  matchId: string,
  input: { provider: "youtube" | "facebook"; destinationId: string; url: string },
): Promise<BroadcastCommandResult> {
  assertBroadcastControlEnabled()
  const providerVideoId = parseProviderVideoId(input.provider, input.url)
  if (!providerVideoId) throw new Error("Use an https URL or id from the selected provider")
  return db.transaction(async tx => {
    const match = await lockMatch(tx, tenantId, matchId)
    const { actor, league, member } = await assertBroadcastOwner(tx, clerkId, tenantId)
    assertBroadcastableMatch(match.status)
    checkPlanFeature({ plan: league.plan as PlanKey, feature: "liveStreaming", label: "Live streaming" })
    await assertNoActiveBroadcast(tx, tenantId, matchId)

    const destination = await readDestination(tx, tenantId, input.destinationId, input.provider)
    const sessionNumber = await nextSessionNumber(tx, matchId)
    const [session] = await tx.insert(broadcastSessions).values({
      tenantId,
      matchId,
      connectionId: destination.connectionId,
      destinationId: destination.id,
      provider: destination.provider,
      sessionNumber,
      desiredState: "starting",
      observedState: "unconfigured",
      playbackVideoId: providerVideoId,
      playbackAvailable: false,
      idempotencyKey: `match:${matchId}:attach:${sessionNumber}`,
      scheduledStartAt: match.scheduledDate,
      providerMetadata: { attached: true },
      createdBy: actor.id,
    }).returning()
    if (!session) throw new Error("Broadcast session could not be created")

    await enqueueBroadcastJob(tx, {
      tenantId,
      sessionId: session.id,
      action: "reconcile",
      idempotencyKey: broadcastJobKey(session.id, "reconcile", "attach"),
      payload: { attached: true, url: input.url },
    })
    await auditBroadcast(tx, {
      tenantId,
      actorId: actor.id,
      actorRole: member.role,
      method: "BROADCAST_ATTACH_REQUESTED",
      path: `/dashboard/matches/${matchId}`,
      payload: {
        matchId,
        sessionId: session.id,
        destinationId: destination.id,
        provider: destination.provider,
        providerVideoId,
      },
    })
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      desiredState: session.desiredState,
      observedState: session.observedState,
    }
  })
}

async function lockSession(tx: Tx, tenantId: string, sessionId: string) {
  await tx.execute(sql`SELECT ${broadcastSessions.id} FROM ${broadcastSessions}
    WHERE ${and(eq(broadcastSessions.id, sessionId), eq(broadcastSessions.tenantId, tenantId))}
    FOR UPDATE`)
  const session = await tx.query.broadcastSessions.findFirst({
    where: and(eq(broadcastSessions.id, sessionId), eq(broadcastSessions.tenantId, tenantId)),
  })
  if (!session || session.id !== sessionId || session.tenantId !== tenantId) {
    throw new Error("Broadcast session not found")
  }
  return session
}

export async function requestBroadcastStart(
  clerkId: string,
  tenantId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> {
  assertBroadcastControlEnabled()
  return db.transaction(async tx => {
    const session = await lockSession(tx, tenantId, sessionId)
    const match = await lockMatch(tx, tenantId, session.matchId)
    const { actor, league, member } = await assertBroadcastOwner(tx, clerkId, tenantId)
    assertBroadcastableMatch(match.status)
    checkPlanFeature({ plan: league.plan as PlanKey, feature: "liveStreaming", label: "Live streaming" })

    if (session.desiredState === "live" || session.observedState === "live") return commandResult(session)
    const attached = isAttached(session.providerMetadata)
    if (attached) {
      await enqueueBroadcastJob(tx, {
        tenantId,
        sessionId,
        action: "reconcile",
        idempotencyKey: broadcastJobKey(sessionId, "reconcile", `manual-${session.revision}`),
        payload: { attached: true },
      })
      await auditBroadcast(tx, {
        tenantId,
        actorId: actor.id,
        actorRole: member.role,
        method: "BROADCAST_ATTACH_REFRESH_REQUESTED",
        path: `/dashboard/matches/${session.matchId}`,
        payload: { matchId: session.matchId, sessionId, provider: session.provider },
      })
      return commandResult(session)
    }
    if (session.desiredState === "starting") return commandResult(session)
    if (session.observedState !== "ready" || session.desiredState !== "ready") {
      throw new Error("The provider has not confirmed this broadcast is ready")
    }

    const [updated] = await tx.update(broadcastSessions).set({
      desiredState: "starting",
      revision: session.revision + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastSessions.id, sessionId),
      eq(broadcastSessions.tenantId, tenantId),
      eq(broadcastSessions.revision, session.revision),
    )).returning()
    if (!updated) throw new Error("Broadcast changed. Reload before starting.")
    await enqueueBroadcastJob(tx, {
      tenantId,
      sessionId,
      action: "start",
      idempotencyKey: broadcastJobKey(sessionId, "start"),
    })
    await auditBroadcast(tx, {
      tenantId,
      actorId: actor.id,
      actorRole: member.role,
      method: "BROADCAST_START_REQUESTED",
      path: `/dashboard/matches/${session.matchId}`,
      payload: { matchId: session.matchId, sessionId, provider: session.provider },
    })
    return commandResult(updated)
  })
}

export async function requestBroadcastEnd(
  clerkId: string,
  tenantId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> {
  assertBroadcastControlEnabled()
  return db.transaction(async tx => {
    const session = await lockSession(tx, tenantId, sessionId)
    await lockMatch(tx, tenantId, session.matchId)
    const { actor, member } = await assertBroadcastOwner(tx, clerkId, tenantId)
    if (session.observedState === "ended") return commandResult(session)
    if (session.desiredState === "ended" && !["live", "interrupted", "ready"].includes(session.observedState)) {
      return commandResult(session)
    }
    if (session.desiredState === "ending") return commandResult(session)

    if (!isAttached(session.providerMetadata) && !session.providerBroadcastId) {
      // Nothing exists at the provider yet, so there is no transition to send.
      // Cancel the request locally instead of failing on an invalid provider id.
      const [cancelled] = await tx.update(broadcastSessions).set({
        desiredState: "ended",
        observedState: "ended",
        playbackAvailable: false,
        endedAt: new Date(),
        revision: session.revision + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(broadcastSessions.id, sessionId),
        eq(broadcastSessions.tenantId, tenantId),
        eq(broadcastSessions.revision, session.revision),
      )).returning()
      if (!cancelled) throw new Error("Broadcast changed. Reload before ending.")
      await auditBroadcast(tx, {
        tenantId,
        actorId: actor.id,
        actorRole: member.role,
        method: "BROADCAST_PREPARE_CANCELLED",
        path: `/dashboard/matches/${session.matchId}`,
        payload: { matchId: session.matchId, sessionId, provider: session.provider },
      })
      return commandResult(cancelled)
    }

    const [updated] = await tx.update(broadcastSessions).set({
      desiredState: "ending",
      revision: session.revision + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastSessions.id, sessionId),
      eq(broadcastSessions.tenantId, tenantId),
      eq(broadcastSessions.revision, session.revision),
    )).returning()
    if (!updated) throw new Error("Broadcast changed. Reload before ending.")
    if (isAttached(session.providerMetadata)) {
      // We do not own an attached provider video. Stop watching it without
      // claiming the provider ended: the last known observation becomes
      // interrupted and any legacy live badge is withdrawn.
      const [stopped] = await tx.update(broadcastSessions).set({
        desiredState: "ended",
        observedState: "interrupted",
        playbackAvailable: false,
        lastErrorCode: "monitoring_stopped",
        revision: updated.revision + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(broadcastSessions.id, sessionId),
        eq(broadcastSessions.tenantId, tenantId),
        eq(broadcastSessions.revision, updated.revision),
      )).returning()
      await tx.update(matches).set({
        streamStatus: "ended",
        updatedAt: new Date(),
      }).where(and(
        eq(matches.id, session.matchId),
        eq(matches.tenantId, tenantId),
      ))
      await auditBroadcast(tx, {
        tenantId,
        actorId: actor.id,
        actorRole: member.role,
        method: "BROADCAST_MONITORING_STOPPED",
        path: `/dashboard/matches/${session.matchId}`,
        payload: { matchId: session.matchId, sessionId, provider: session.provider },
      })
      return commandResult(stopped ?? updated)
    }
    await enqueueBroadcastJob(tx, {
      tenantId,
      sessionId,
      action: "end",
      idempotencyKey: broadcastJobKey(sessionId, "end"),
    })
    await auditBroadcast(tx, {
      tenantId,
      actorId: actor.id,
      actorRole: member.role,
      method: "BROADCAST_END_REQUESTED",
      path: `/dashboard/matches/${session.matchId}`,
      payload: { matchId: session.matchId, sessionId, provider: session.provider },
    })
    return commandResult(updated)
  })
}

export async function refreshBroadcastSession(
  clerkId: string,
  tenantId: string,
  sessionId: string,
): Promise<BroadcastCommandResult> {
  assertBroadcastControlEnabled()
  return db.transaction(async tx => {
    const session = await lockSession(tx, tenantId, sessionId)
    await assertBroadcastOwner(tx, clerkId, tenantId)
    await enqueueBroadcastJob(tx, {
      tenantId,
      sessionId,
      action: "reconcile",
      idempotencyKey: broadcastJobKey(sessionId, "reconcile", `manual-${session.revision}`),
      payload: { attached: isAttached(session.providerMetadata) },
    })
    return commandResult(session)
  })
}

export type BroadcastIngestDetails = {
  rtmpUrl: string
  streamKey: string
}

/**
 * Reveal the encrypted ingest key to the owning league operator only. The
 * browser receives it once on explicit request; no read projection includes it.
 */
export async function readBroadcastIngest(
  clerkId: string,
  tenantId: string,
  sessionId: string,
): Promise<BroadcastIngestDetails> {
  assertBroadcastControlEnabled()
  return db.transaction(async tx => {
    const session = await lockSession(tx, tenantId, sessionId)
    await assertBroadcastOwner(tx, clerkId, tenantId)
    if (isAttached(session.providerMetadata) || !session.ingestSecretRef) {
      throw new Error("This broadcast has no managed ingest key")
    }
    return decryptBroadcastIngest(sessionId, session.ingestSecretRef)
  })
}

export async function setDefaultBroadcastDestination(
  clerkId: string,
  tenantId: string,
  destinationId: string,
): Promise<{ destinationId: string }> {
  assertBroadcastControlEnabled()
  return db.transaction(async tx => {
    const { actor, member } = await assertBroadcastOwner(tx, clerkId, tenantId)
    const destination = await readDestination(tx, tenantId, destinationId)
    await tx.update(broadcastDestinations).set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(broadcastDestinations.tenantId, tenantId),
        eq(broadcastDestinations.provider, destination.provider),
      ))
    await tx.update(broadcastDestinations).set({ isDefault: true, updatedAt: new Date() })
      .where(and(
        eq(broadcastDestinations.tenantId, tenantId),
        eq(broadcastDestinations.id, destinationId),
      ))
    await auditBroadcast(tx, {
      tenantId,
      actorId: actor.id,
      actorRole: member.role,
      method: "BROADCAST_DESTINATION_DEFAULT",
      path: "/dashboard/settings/broadcast",
      payload: { destinationId, provider: destination.provider },
    })
    return { destinationId }
  })
}

export async function readBroadcastControlData(
  tenantId: string,
  matchId: string,
): Promise<BroadcastControlData> {
  if (!broadcastControlEnabled()) return { destinations: [], sessions: [] }

  const [destinationRows, sessionRows] = await Promise.all([
    db.select({
      id: broadcastDestinations.id,
      provider: broadcastDestinations.provider,
      name: broadcastDestinations.name,
      kind: broadcastDestinations.kind,
      isDefault: broadcastDestinations.isDefault,
      connectionDisplayName: broadcastConnections.displayName,
      connectionStatus: broadcastConnections.status,
      connectionExpiresAt: broadcastConnections.expiresAt,
    }).from(broadcastDestinations)
      .innerJoin(broadcastConnections, and(
        eq(broadcastDestinations.connectionId, broadcastConnections.id),
        eq(broadcastDestinations.tenantId, broadcastConnections.tenantId),
      ))
      .where(and(
        eq(broadcastDestinations.tenantId, tenantId),
        eq(broadcastDestinations.isActive, true),
        eq(broadcastConnections.status, "active"),
      ))
      .orderBy(desc(broadcastDestinations.isDefault), asc(broadcastDestinations.name)),
    db.select({
      id: broadcastSessions.id,
      sessionNumber: broadcastSessions.sessionNumber,
      provider: broadcastSessions.provider,
      desiredState: broadcastSessions.desiredState,
      observedState: broadcastSessions.observedState,
      destinationId: broadcastSessions.destinationId,
      destinationName: broadcastDestinations.name,
      providerVideoId: broadcastSessions.playbackVideoId,
      playbackAvailable: broadcastSessions.playbackAvailable,
      scheduledStartAt: broadcastSessions.scheduledStartAt,
      startedAt: broadcastSessions.startedAt,
      endedAt: broadcastSessions.endedAt,
      lastErrorCode: broadcastSessions.lastErrorCode,
      revision: broadcastSessions.revision,
      providerMetadata: broadcastSessions.providerMetadata,
    }).from(broadcastSessions)
      .innerJoin(broadcastDestinations, and(
        eq(broadcastSessions.destinationId, broadcastDestinations.id),
        eq(broadcastSessions.tenantId, broadcastDestinations.tenantId),
      ))
      .where(and(
        eq(broadcastSessions.tenantId, tenantId),
        eq(broadcastSessions.matchId, matchId),
      ))
      .orderBy(asc(broadcastSessions.sessionNumber)),
  ])

  return {
    destinations: destinationRows
      .filter(row => row.connectionExpiresAt === null || row.connectionExpiresAt.getTime() > Date.now())
      .map(row => ({
        id: row.id,
        provider: row.provider as BroadcastDestinationOption["provider"],
        name: row.name,
        kind: row.kind as BroadcastDestinationOption["kind"],
        isDefault: row.isDefault,
        connectionDisplayName: row.connectionDisplayName,
        connectionStatus: row.connectionStatus as BroadcastDestinationOption["connectionStatus"],
      })),
    sessions: sessionRows.map(row => ({
      id: row.id,
      sessionNumber: row.sessionNumber,
      provider: row.provider as BroadcastSessionSummary["provider"],
      desiredState: row.desiredState as BroadcastSessionSummary["desiredState"],
      observedState: row.observedState as BroadcastSessionSummary["observedState"],
      destinationId: row.destinationId,
      destinationName: row.destinationName,
      providerVideoId: row.providerVideoId,
      playbackAvailable: row.playbackAvailable,
      scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      revision: row.revision,
      attached: isAttached(row.providerMetadata),
    })),
  }
}

export async function readBroadcastDestinations(
  tenantId: string,
): Promise<BroadcastDestinationOption[]> {
  if (!broadcastControlEnabled()) return []
  const rows = await db.select({
    id: broadcastDestinations.id,
    provider: broadcastDestinations.provider,
    name: broadcastDestinations.name,
    kind: broadcastDestinations.kind,
    isDefault: broadcastDestinations.isDefault,
    connectionDisplayName: broadcastConnections.displayName,
    connectionStatus: broadcastConnections.status,
    connectionExpiresAt: broadcastConnections.expiresAt,
  }).from(broadcastDestinations)
    .innerJoin(broadcastConnections, and(
      eq(broadcastDestinations.connectionId, broadcastConnections.id),
      eq(broadcastDestinations.tenantId, broadcastConnections.tenantId),
    ))
    .where(and(
      eq(broadcastDestinations.tenantId, tenantId),
      eq(broadcastDestinations.isActive, true),
      eq(broadcastConnections.status, "active"),
    ))
    .orderBy(desc(broadcastDestinations.isDefault), asc(broadcastDestinations.name))
  return rows
    .filter(row => row.connectionExpiresAt === null || row.connectionExpiresAt.getTime() > Date.now())
    .map(row => ({
      id: row.id,
      provider: row.provider as BroadcastDestinationOption["provider"],
      name: row.name,
      kind: row.kind as BroadcastDestinationOption["kind"],
      isDefault: row.isDefault,
      connectionDisplayName: row.connectionDisplayName,
      connectionStatus: row.connectionStatus as BroadcastDestinationOption["connectionStatus"],
    }))
}

function isAttached(metadata: unknown): boolean {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    && (metadata as { attached?: unknown }).attached === true
}

function commandResult(session: {
  id: string
  sessionNumber: number
  desiredState: string
  observedState: string
}): BroadcastCommandResult {
  return {
    sessionId: session.id,
    sessionNumber: session.sessionNumber,
    desiredState: session.desiredState,
    observedState: session.observedState,
  }
}
