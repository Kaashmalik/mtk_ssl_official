import { and, eq, inArray } from "drizzle-orm"
import {
  broadcastArchives,
  broadcastSessions,
  db,
} from "@mtk/database"
import {
  buildBroadcastPlaybackCatalogue,
  type BroadcastArchivePlaybackInput,
  type BroadcastPlaybackCatalogue,
  type BroadcastProvider,
  type BroadcastSessionPlaybackInput,
} from "@mtk/contracts"
import { isMatchPublished } from "@/lib/public-visibility"

/**
 * ENH-08-03: read the public playback/replay catalogue for one published match.
 *
 * `match` MUST come from `readPublishedMatch` (tenant scoped + publication
 * gated, including its parent tournament); this reader re-checks the match
 * status as defence in depth and scopes the broadcast queries to the same
 * tenant. It selects no credentials, ingest secrets, provider metadata beyond
 * the bounded highlights allowlist, or internal jobs.
 *
 * The verified broadcast tables are additive and may not be applied in an
 * environment yet, so the read is behind `BROADCAST_PLAYBACK_READY`. When the
 * flag is off, only the pre-existing legacy live URL is considered - and the
 * shared contract still refuses lookalike hosts and never calls an ended URL a
 * replay. Enabling the flag before applying the migration is an operator error,
 * not a reason to silently invent data.
 */
export const broadcastPlaybackReadsEnabled = () =>
  process.env.BROADCAST_PLAYBACK_READY === "true"

type PublishedMatchPlaybackRow = {
  id: string
  status: string
  streamSource: string | null
  streamStatus: string | null
  liveStreamUrl: string | null
}

function emptyCatalogue(match: PublishedMatchPlaybackRow, now?: Date): BroadcastPlaybackCatalogue {
  return buildBroadcastPlaybackCatalogue({
    sessions: [],
    archives: [],
    legacy: {
      status: match.streamStatus,
      source: match.streamSource,
      url: match.liveStreamUrl,
    },
    now,
  })
}

export async function readPublishedMatchPlayback(
  tenantId: string,
  match: PublishedMatchPlaybackRow,
  options: { now?: Date } = {},
): Promise<BroadcastPlaybackCatalogue> {
  // A draft/cancelled match has no public catalogue even if broadcast rows exist.
  if (!isMatchPublished(match.status)) {
    return buildBroadcastPlaybackCatalogue({
      sessions: [],
      archives: [],
      legacy: { status: null, source: null, url: null },
      now: options.now,
    })
  }

  if (!broadcastPlaybackReadsEnabled()) return emptyCatalogue(match, options.now)

  const sessionRows = await db
    .select({
      id: broadcastSessions.id,
      provider: broadcastSessions.provider,
      sessionNumber: broadcastSessions.sessionNumber,
      desiredState: broadcastSessions.desiredState,
      observedState: broadcastSessions.observedState,
      playbackVideoId: broadcastSessions.playbackVideoId,
      playbackAvailable: broadcastSessions.playbackAvailable,
      scheduledStartAt: broadcastSessions.scheduledStartAt,
      startedAt: broadcastSessions.startedAt,
      endedAt: broadcastSessions.endedAt,
    })
    .from(broadcastSessions)
    .where(and(
      eq(broadcastSessions.tenantId, tenantId),
      eq(broadcastSessions.matchId, match.id),
    ))
    .orderBy(broadcastSessions.sessionNumber)

  if (sessionRows.length === 0) return emptyCatalogue(match, options.now)

  const sessions: BroadcastSessionPlaybackInput[] = sessionRows.map(row => ({
    ...row,
    provider: row.provider as BroadcastProvider,
    desiredState: row.desiredState as BroadcastSessionPlaybackInput["desiredState"],
    observedState: row.observedState as BroadcastSessionPlaybackInput["observedState"],
  }))

  const archiveRows = await db
    .select({
      id: broadcastArchives.id,
      sessionId: broadcastArchives.sessionId,
      providerVideoId: broadcastArchives.providerVideoId,
      status: broadcastArchives.status,
      durationSeconds: broadcastArchives.durationSeconds,
      availableAt: broadcastArchives.availableAt,
      retentionUntil: broadcastArchives.retentionUntil,
      metadata: broadcastArchives.metadata,
    })
    .from(broadcastArchives)
    .where(and(
      eq(broadcastArchives.tenantId, tenantId),
      inArray(broadcastArchives.sessionId, sessionRows.map(row => row.id)),
    ))

  const archives: BroadcastArchivePlaybackInput[] = archiveRows.map(row => ({
    ...row,
    status: row.status as BroadcastArchivePlaybackInput["status"],
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  }))

  return buildBroadcastPlaybackCatalogue({
    sessions,
    archives,
    legacy: {
      status: match.streamStatus,
      source: match.streamSource,
      url: match.liveStreamUrl,
    },
    now: options.now,
  })
}
