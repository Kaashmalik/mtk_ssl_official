import { randomUUID } from "node:crypto"
import {
  auditLogs, broadcastConnections, broadcastDestinations, db, tenants,
} from "@mtk/database"
import { broadcastDestinationDecision } from "@mtk/contracts"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"

/**
 * ENH-08-01: platform-operator seeding of provider connections and approved
 * destinations.
 *
 * The league owner never enters a token. An operator records an opaque
 * secret-store reference (`secret://NAME` or `env://NAME`) that the worker
 * resolves behind the allowlist in broadcast-credentials.ts. This library
 * never returns the reference in a read projection.
 */

const credentialRefSchema = z.string().trim().min(10).max(500)
  .regex(/^(?:env|secret):\/\/[A-Z][A-Z0-9_]{2,80}$/, "Use an opaque env:// or secret:// reference")

export const createBroadcastConnectionSchema = z.object({
  action: z.literal("create_connection"),
  tenantId: z.string().uuid(),
  provider: z.enum(["youtube", "facebook"]),
  externalAccountId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(1).max(160),
  credentialRef: credentialRefSchema,
  scopes: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict()

export const createBroadcastDestinationSchema = z.object({
  action: z.literal("create_destination"),
  tenantId: z.string().uuid(),
  connectionId: z.string().uuid(),
  externalId: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["channel", "playlist", "page"]),
  isDefault: z.boolean().default(false),
}).strict()

export const setBroadcastConnectionStatusSchema = z.object({
  action: z.literal("set_connection_status"),
  tenantId: z.string().uuid(),
  connectionId: z.string().uuid(),
  status: z.enum(["active", "expired", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export const broadcastAdminActionSchema = z.discriminatedUnion("action", [
  createBroadcastConnectionSchema,
  createBroadcastDestinationSchema,
  setBroadcastConnectionStatusSchema,
])

export type BroadcastAdminAction = z.infer<typeof broadcastAdminActionSchema>

export type BroadcastAdminConnection = {
  id: string
  tenantId: string
  provider: "youtube" | "facebook"
  externalAccountId: string
  displayName: string
  scopes: string[]
  status: "active" | "expired" | "revoked"
  expiresAt: Date | null
  createdAt: Date
  destinations: BroadcastAdminDestination[]
}

export type BroadcastAdminDestination = {
  id: string
  provider: "youtube" | "facebook"
  externalId: string
  name: string
  kind: "channel" | "playlist" | "page"
  isDefault: boolean
  isActive: boolean
}

export async function listBroadcastConnections(input: {
  tenantId?: string
  limit?: number
} = {}): Promise<BroadcastAdminConnection[]> {
  const tenantId = input.tenantId
  const limit = Math.max(1, Math.min(200, input.limit ?? 100))
  const connections = await db.select({
    id: broadcastConnections.id,
    tenantId: broadcastConnections.tenantId,
    provider: broadcastConnections.provider,
    externalAccountId: broadcastConnections.externalAccountId,
    displayName: broadcastConnections.displayName,
    scopes: broadcastConnections.scopes,
    status: broadcastConnections.status,
    expiresAt: broadcastConnections.expiresAt,
    createdAt: broadcastConnections.createdAt,
  }).from(broadcastConnections)
    .where(tenantId ? eq(broadcastConnections.tenantId, tenantId) : undefined)
    .orderBy(asc(broadcastConnections.createdAt))
    .limit(limit)

  const destinations = await db.select({
    id: broadcastDestinations.id,
    tenantId: broadcastDestinations.tenantId,
    connectionId: broadcastDestinations.connectionId,
    provider: broadcastDestinations.provider,
    externalId: broadcastDestinations.externalId,
    name: broadcastDestinations.name,
    kind: broadcastDestinations.kind,
    isDefault: broadcastDestinations.isDefault,
    isActive: broadcastDestinations.isActive,
  }).from(broadcastDestinations)
    .where(tenantId ? eq(broadcastDestinations.tenantId, tenantId) : undefined)
    .orderBy(asc(broadcastDestinations.name))

  const byConnection = new Map<string, BroadcastAdminDestination[]>()
  for (const destination of destinations) {
    const list = byConnection.get(destination.connectionId) ?? []
    list.push({
      id: destination.id,
      provider: destination.provider as BroadcastAdminDestination["provider"],
      externalId: destination.externalId,
      name: destination.name,
      kind: destination.kind as BroadcastAdminDestination["kind"],
      isDefault: destination.isDefault,
      isActive: destination.isActive,
    })
    byConnection.set(destination.connectionId, list)
  }

  return connections.map(connection => ({
    id: connection.id,
    tenantId: connection.tenantId,
    provider: connection.provider as BroadcastAdminConnection["provider"],
    externalAccountId: connection.externalAccountId,
    displayName: connection.displayName,
    scopes: connection.scopes,
    status: (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()
      ? "expired"
      : connection.status) as BroadcastAdminConnection["status"],
    expiresAt: connection.expiresAt,
    createdAt: connection.createdAt,
    destinations: byConnection.get(connection.id) ?? [],
  }))
}

async function assertTenant(tenantId: string) {
  const [tenant] = await db.select({ id: tenants.id, isActive: tenants.isActive })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!tenant || tenant.isActive !== true) throw new Error("League not found")
}

export async function applyBroadcastAdminAction(
  actorId: string,
  action: BroadcastAdminAction,
): Promise<{ id: string }> {
  if (action.action === "create_connection") {
    await assertTenant(action.tenantId)
    return db.transaction(async tx => {
      const [created] = await tx.insert(broadcastConnections).values({
        tenantId: action.tenantId,
        provider: action.provider,
        externalAccountId: action.externalAccountId,
        displayName: action.displayName,
        credentialRef: action.credentialRef,
        scopes: action.scopes,
        status: action.expiresAt && new Date(action.expiresAt).getTime() <= Date.now()
          ? "expired"
          : "active",
        expiresAt: action.expiresAt ? new Date(action.expiresAt) : null,
        createdBy: actorId,
      }).returning({ id: broadcastConnections.id })
      if (!created) throw new Error("Broadcast connection could not be created")
      await tx.insert(auditLogs).values({
        requestId: randomUUID(),
        tenantId: action.tenantId,
        actorId,
        actorRole: "super_admin",
        method: "BROADCAST_CONNECTION_CREATED",
        path: "/api/admin/broadcast-connections",
        statusCode: "200",
        payload: {
          connectionId: created.id,
          provider: action.provider,
          externalAccountId: action.externalAccountId,
        },
      })
      return { id: created.id }
    })
  }

  if (action.action === "create_destination") {
    await assertTenant(action.tenantId)
    return db.transaction(async tx => {
      const [connection] = await tx.select({
        id: broadcastConnections.id,
        tenantId: broadcastConnections.tenantId,
        provider: broadcastConnections.provider,
        status: broadcastConnections.status,
      }).from(broadcastConnections)
        .where(and(
          eq(broadcastConnections.id, action.connectionId),
          eq(broadcastConnections.tenantId, action.tenantId),
        ))
        .for("update")
        .limit(1)
      if (!connection) throw new Error("Broadcast connection not found")
      const decision = broadcastDestinationDecision({
        requestTenantId: action.tenantId,
        connectionTenantId: connection.tenantId,
        connectionProvider: connection.provider as "youtube" | "facebook",
        destinationProvider: connection.provider as "youtube" | "facebook",
        connectionStatus: connection.status as "active" | "expired" | "revoked",
        destinationActive: true,
        destinationKind: action.kind,
        provider: connection.provider as "youtube" | "facebook",
      })
      if (!decision.allowed) throw new Error(`Destination refused: ${decision.reason}`)

      if (action.kind === "playlist") {
        const [existingPlaylist] = await tx.select({ id: broadcastDestinations.id })
          .from(broadcastDestinations)
          .where(and(
            eq(broadcastDestinations.tenantId, action.tenantId),
            eq(broadcastDestinations.provider, connection.provider),
            eq(broadcastDestinations.kind, "playlist"),
          ))
          .limit(1)
        if (existingPlaylist) throw new Error("A playlist destination already exists for this league")
      }

      if (action.isDefault) {
        await tx.update(broadcastDestinations).set({ isDefault: false, updatedAt: new Date() })
          .where(and(
            eq(broadcastDestinations.tenantId, action.tenantId),
            eq(broadcastDestinations.provider, connection.provider),
          ))
      }
      const [created] = await tx.insert(broadcastDestinations).values({
        tenantId: action.tenantId,
        connectionId: connection.id,
        provider: connection.provider,
        externalId: action.externalId,
        name: action.name,
        kind: action.kind,
        isDefault: action.isDefault,
      }).returning({ id: broadcastDestinations.id })
      if (!created) throw new Error("Broadcast destination could not be created")
      await tx.insert(auditLogs).values({
        requestId: randomUUID(),
        tenantId: action.tenantId,
        actorId,
        actorRole: "super_admin",
        method: "BROADCAST_DESTINATION_CREATED",
        path: "/api/admin/broadcast-connections",
        statusCode: "200",
        payload: {
          destinationId: created.id,
          connectionId: connection.id,
          provider: connection.provider,
          kind: action.kind,
          isDefault: action.isDefault,
        },
      })
      return { id: created.id }
    })
  }

  await assertTenant(action.tenantId)
  return db.transaction(async tx => {
    const [updated] = await tx.update(broadcastConnections).set({
      status: action.status,
      ...(action.expiresAt !== undefined
        ? { expiresAt: action.expiresAt ? new Date(action.expiresAt) : null }
        : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastConnections.id, action.connectionId),
      eq(broadcastConnections.tenantId, action.tenantId),
    )).returning({ id: broadcastConnections.id })
    if (!updated) throw new Error("Broadcast connection not found")
    await tx.update(broadcastDestinations).set({
      isActive: action.status === "active",
      updatedAt: new Date(),
    }).where(and(
      eq(broadcastDestinations.tenantId, action.tenantId),
      eq(broadcastDestinations.connectionId, updated.id),
    ))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: action.tenantId,
      actorId,
      actorRole: "super_admin",
      method: "BROADCAST_CONNECTION_STATUS",
      path: "/api/admin/broadcast-connections",
      statusCode: "200",
      payload: { connectionId: updated.id, status: action.status },
    })
    return { id: updated.id }
  })
}
