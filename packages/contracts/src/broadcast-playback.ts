/**
 * ENH-08-03: portable public playback/replay catalogue.
 *
 * The catalogue is a PRESENTATION projection over provider-observed broadcast
 * state. It never promotes a prepared request to "live", never treats a legacy
 * URL as a verified replay, and never builds an embed for a hostname outside the
 * exact provider allowlist. Provider credentials, stream keys, session tokens
 * and database access stay in server adapters.
 *
 * Pure+zod only: native/web can share the same vocabulary and validation.
 */

import type {
  BroadcastDesiredState,
  BroadcastObservedState,
  BroadcastProvider,
} from "./broadcast"

export const BROADCAST_PLAYBACK_STATE_VALUES = [
  "live",
  "upcoming",
  "replay",
  "unavailable",
] as const
export type BroadcastPlaybackState = (typeof BROADCAST_PLAYBACK_STATE_VALUES)[number]

export const BROADCAST_PLAYBACK_KIND_VALUES = ["live", "replay", "highlights"] as const
export type BroadcastPlaybackKind = (typeof BROADCAST_PLAYBACK_KIND_VALUES)[number]

/**
 * One addressable public video. `providerVideoId` is the exact provider id when
 * the source is a verified broadcast/archive row; legacy URLs may be embeddable
 * without a parsed id (`legacy: true`), which is why the field is nullable.
 */
export type BroadcastPlaybackItem = {
  /** Stable projection identity (session/archive + kind), not a provider id. */
  id: string
  kind: BroadcastPlaybackKind
  provider: BroadcastProvider
  providerVideoId: string | null
  /** Already allowlist-validated https embed URL. */
  embedUrl: string
  /** Human-facing provider page (never an embed/plugin URL). */
  externalUrl: string
  title: string
  thumbnailUrl: string | null
  durationSeconds: number | null
  availableAt: string | null
  sessionId: string
  archiveId: string | null
  /** True only for a pre-broadcast URL that has no verified provider identity. */
  legacy: boolean
}

export type BroadcastPlaybackCatalogue = {
  state: BroadcastPlaybackState
  live: BroadcastPlaybackItem | null
  upcomingAt: string | null
  replays: BroadcastPlaybackItem[]
  highlights: BroadcastPlaybackItem[]
}

export type BroadcastSessionPlaybackInput = {
  id: string
  provider: BroadcastProvider
  sessionNumber: number
  desiredState: BroadcastDesiredState
  observedState: BroadcastObservedState
  playbackVideoId: string | null
  playbackAvailable: boolean
  scheduledStartAt: Date | string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
}

export type BroadcastArchivePlaybackInput = {
  id: string
  sessionId: string
  providerVideoId: string | null
  status: "pending" | "processing" | "ready" | "failed" | "expired"
  durationSeconds: number | null
  availableAt: Date | string | null
  retentionUntil: Date | string | null
  metadata?: Record<string, unknown> | null
}

export type LegacyLivePlaybackInput = {
  status: string | null
  source: string | null
  url: string | null
}

const YOUTUBE_HOST_SUFFIXES = ["youtube.com", "youtube-nocookie.com"] as const
const YOUTUBE_SHORT_HOST_SUFFIXES = ["youtu.be"] as const
const FACEBOOK_HOST_SUFFIXES = ["facebook.com", "fb.watch"] as const
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/
const FACEBOOK_ID_RE = /^\d{5,30}$/

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`)
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:") return null
    return url
  } catch {
    return null
  }
}

function isYouTubeHost(hostname: string): boolean {
  return YOUTUBE_HOST_SUFFIXES.some(suffix => hostMatches(hostname, suffix))
}

function isYouTubeShortHost(hostname: string): boolean {
  return YOUTUBE_SHORT_HOST_SUFFIXES.some(suffix => hostMatches(hostname, suffix))
}

function isFacebookHost(hostname: string): boolean {
  return FACEBOOK_HOST_SUFFIXES.some(suffix => hostMatches(hostname, suffix))
}

/**
 * Extract a YouTube id from a bare id or an allowlisted provider URL.
 *
 * Host matching is suffix-bounded (`host === domain || host.endsWith("." + domain)`),
 * so `youtube.com.evil.example`, `notyoutube.com` and non-https payloads are
 * refused. Only documented path shapes are accepted.
 */
export function parseYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim()
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed

  const url = parseHttpsUrl(trimmed)
  if (!url) return null

  if (isYouTubeShortHost(url.hostname)) {
    const candidate = url.pathname.split("/").filter(Boolean)[0] ?? ""
    return YOUTUBE_ID_RE.test(candidate) ? candidate : null
  }
  if (!isYouTubeHost(url.hostname)) return null

  const parts = url.pathname.split("/").filter(Boolean)
  const pathCandidate =
    parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "v"
      ? parts[1] ?? ""
      : ""
  const candidate = pathCandidate || url.searchParams.get("v") || ""
  return YOUTUBE_ID_RE.test(candidate) ? candidate : null
}

/** Extract a Facebook numeric video id from a bare id or allowlisted URL. */
export function parseFacebookVideoId(value: string): string | null {
  const trimmed = value.trim()
  if (FACEBOOK_ID_RE.test(trimmed)) return trimmed

  const url = parseHttpsUrl(trimmed)
  if (!url || !isFacebookHost(url.hostname)) return null

  const fromQuery = url.searchParams.get("v")?.trim() ?? ""
  if (FACEBOOK_ID_RE.test(fromQuery)) return fromQuery

  const parts = url.pathname.split("/").filter(Boolean)
  const videosIndex = parts.indexOf("videos")
  const fromPath = videosIndex >= 0 ? parts[videosIndex + 1] ?? "" : ""
  if (FACEBOOK_ID_RE.test(fromPath)) return fromPath

  const last = parts.at(-1) ?? ""
  return FACEBOOK_ID_RE.test(last) ? last : null
}

export function parseProviderVideoId(provider: BroadcastProvider, value: string): string | null {
  return provider === "youtube" ? parseYouTubeVideoId(value) : parseFacebookVideoId(value)
}

/**
 * Build a public embed/watch URL for a validated provider video id.
 * Returns null rather than inventing an address for an invalid id.
 */
export function buildProviderPlaybackUrls(
  provider: BroadcastProvider,
  providerVideoId: string,
  options: { autoplay?: boolean } = {},
): { embedUrl: string; externalUrl: string; thumbnailUrl: string | null } | null {
  if (provider === "youtube") {
    if (!YOUTUBE_ID_RE.test(providerVideoId)) return null
    const autoplay = options.autoplay === false ? "0" : "1"
    return {
      embedUrl: `https://www.youtube.com/embed/${providerVideoId}?autoplay=${autoplay}&mute=1&playsinline=1&rel=0`,
      externalUrl: `https://www.youtube.com/watch?v=${providerVideoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${providerVideoId}/hqdefault.jpg`,
    }
  }
  if (!FACEBOOK_ID_RE.test(providerVideoId)) return null
  const href = `https://www.facebook.com/watch/?v=${providerVideoId}`
  const autoplay = options.autoplay === false ? "false" : "true"
  return {
    embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&autoplay=${autoplay}&mute=true`,
    externalUrl: href,
    thumbnailUrl: null,
  }
}

/**
 * Legacy Facebook live URLs can be embedded without a numeric id (for example
 * `/watch/live/...`). This is the one place a raw URL is accepted, and only
 * after the exact https host allowlist. It is never used for replay claims.
 */
export function buildLegacyFacebookEmbedUrl(
  value: string,
): { embedUrl: string; externalUrl: string } | null {
  const url = parseHttpsUrl(value)
  if (!url || !isFacebookHost(url.hostname)) return null
  const href = url.toString()
  return {
    embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&autoplay=true&mute=true`,
    externalUrl: href,
  }
}

/** True only for an https embed URL on a provider-owned domain and path. */
export function isAllowedProviderEmbedUrl(value: string): boolean {
  const url = parseHttpsUrl(value)
  if (!url || url.protocol !== "https:") return false
  if (isYouTubeHost(url.hostname)) {
    return url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/")
  }
  if (isFacebookHost(url.hostname)) {
    return url.pathname === "/plugins/video.php"
  }
  return false
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIso(value: Date | string | null | undefined): string | null {
  return toDate(value)?.toISOString() ?? null
}

function safeDuration(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 24 * 60 * 60) {
    return null
  }
  return Math.round(value)
}

function itemFor(
  provider: BroadcastProvider,
  providerVideoId: string,
  input: {
    id: string
    kind: BroadcastPlaybackKind
    sessionId: string
    archiveId: string | null
    title: string
    durationSeconds: number | null
    availableAt: string | null
    legacy?: boolean
  },
): BroadcastPlaybackItem | null {
  const urls = buildProviderPlaybackUrls(provider, providerVideoId)
  if (!urls) return null
  return {
    id: input.id,
    kind: input.kind,
    provider,
    providerVideoId,
    embedUrl: urls.embedUrl,
    externalUrl: urls.externalUrl,
    title: input.title,
    thumbnailUrl: urls.thumbnailUrl,
    durationSeconds: safeDuration(input.durationSeconds),
    availableAt: input.availableAt,
    sessionId: input.sessionId,
    archiveId: input.archiveId,
    legacy: input.legacy ?? false,
  }
}

/**
 * Legacy match rows pre-date the verified broadcast plane. A live URL may still
 * be embedded after exact host validation, but it is explicitly marked
 * `legacy: true`; an ended legacy URL is NOT promoted to a replay because no
 * durable archive identity exists for it.
 */
function buildLegacyLiveItem(input: LegacyLivePlaybackInput): BroadcastPlaybackItem | null {
  if (input.status !== "live" || !input.url) return null
  const trimmed = input.url.trim()

  if (input.source === "youtube") {
    const videoId = parseYouTubeVideoId(trimmed)
    if (!videoId) return null
    return itemFor("youtube", videoId, {
      id: "legacy:live",
      kind: "live",
      sessionId: "legacy",
      archiveId: null,
      title: "Live stream",
      durationSeconds: null,
      availableAt: null,
      legacy: true,
    })
  }

  if (input.source === "facebook") {
    const urls = buildLegacyFacebookEmbedUrl(trimmed)
    if (!urls) return null
    return {
      id: "legacy:live",
      kind: "live",
      provider: "facebook",
      providerVideoId: parseFacebookVideoId(trimmed),
      embedUrl: urls.embedUrl,
      externalUrl: urls.externalUrl,
      title: "Live stream",
      thumbnailUrl: null,
      durationSeconds: null,
      availableAt: null,
      sessionId: "legacy",
      archiveId: null,
      legacy: true,
    }
  }

  return null
}

type HighlightMetadata = { videoId: string; title?: string; durationSeconds?: number }

function readHighlights(metadata: Record<string, unknown> | null | undefined): HighlightMetadata[] {
  if (!metadata) return []
  const raw = metadata.highlights
  if (!Array.isArray(raw)) return []
  const out: HighlightMetadata[] = []
  for (const entry of raw.slice(0, 20)) {
    if (typeof entry === "string") {
      out.push({ videoId: entry })
      continue
    }
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const videoId = typeof record.videoId === "string" ? record.videoId : null
    if (!videoId) continue
    out.push({
      videoId,
      title: typeof record.title === "string" ? record.title.slice(0, 120) : undefined,
      durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : undefined,
    })
  }
  return out
}

/**
 * Build the truthful public catalogue.
 *
 * - `live` requires provider-observed `live`, `playbackAvailable`, and a valid
 *   video id. A prepared/ready/starting request is never watchable yet.
 * - `replay` requires a READY archive with a valid video id whose retention has
 *   not expired. Processing/failed/expired archives are omitted, never labelled
 *   available.
 * - `upcoming` requires an unfinished session with a future scheduled start.
 * - Legacy live rows are used only when no verified live session exists.
 */
export function buildBroadcastPlaybackCatalogue(input: {
  sessions: readonly BroadcastSessionPlaybackInput[]
  archives: readonly BroadcastArchivePlaybackInput[]
  legacy?: LegacyLivePlaybackInput | null
  now?: Date
}): BroadcastPlaybackCatalogue {
  const now = input.now ?? new Date()
  const sessionsById = new Map(input.sessions.map(session => [session.id, session]))

  const liveCandidates = input.sessions
    .filter(session => session.observedState === "live" && session.playbackAvailable && !!session.playbackVideoId)
    .sort((a, b) => {
      const aStarted = toDate(a.startedAt)?.getTime() ?? 0
      const bStarted = toDate(b.startedAt)?.getTime() ?? 0
      return bStarted - aStarted || b.sessionNumber - a.sessionNumber
    })
  const liveSession = liveCandidates[0]
  const live = liveSession?.playbackVideoId
    ? itemFor(liveSession.provider, liveSession.playbackVideoId, {
      id: `${liveSession.id}:live`,
      kind: "live",
      sessionId: liveSession.id,
      archiveId: null,
      title: `Live stream${liveSession.sessionNumber > 1 ? ` - part ${liveSession.sessionNumber}` : ""}`,
      durationSeconds: null,
      availableAt: toIso(liveSession.startedAt),
    })
    : null

  const replays: BroadcastPlaybackItem[] = []
  const highlights: BroadcastPlaybackItem[] = []
  for (const archive of input.archives) {
    if (archive.status !== "ready") continue
    // A missing retention boundary is unbounded, but an unreadable one is not:
    // fail closed rather than exposing a replay whose window cannot be proven.
    if (archive.retentionUntil != null) {
      const retention = toDate(archive.retentionUntil)
      if (!retention || retention.getTime() <= now.getTime()) continue
    }

    const session = sessionsById.get(archive.sessionId)
    if (!session) continue
    if (session.observedState !== "replay_ready" && session.observedState !== "ended") continue

    if (archive.providerVideoId) {
      const replay = itemFor(session.provider, archive.providerVideoId, {
        id: `${archive.id}:replay`,
        kind: "replay",
        sessionId: session.id,
        archiveId: archive.id,
        title: `Replay${session.sessionNumber > 1 ? ` - part ${session.sessionNumber}` : ""}`,
        durationSeconds: archive.durationSeconds,
        availableAt: toIso(archive.availableAt) ?? toIso(session.endedAt),
      })
      if (replay) replays.push(replay)
    }

    readHighlights(archive.metadata).forEach((highlight, index) => {
      const videoId = parseProviderVideoId(session.provider, highlight.videoId)
      if (!videoId) return
      const item = itemFor(session.provider, videoId, {
        id: `${archive.id}:highlight:${index}`,
        kind: "highlights",
        sessionId: session.id,
        archiveId: archive.id,
        title: highlight.title?.trim() || `Highlights${session.sessionNumber > 1 ? ` - part ${session.sessionNumber}` : ""}`,
        durationSeconds: highlight.durationSeconds ?? null,
        availableAt: toIso(archive.availableAt),
      })
      if (item) highlights.push(item)
    })
  }
  replays.sort((a, b) => {
    const aAt = a.availableAt ? Date.parse(a.availableAt) : 0
    const bAt = b.availableAt ? Date.parse(b.availableAt) : 0
    return bAt - aAt || a.id.localeCompare(b.id)
  })
  highlights.sort((a, b) => {
    const aAt = a.availableAt ? Date.parse(a.availableAt) : 0
    const bAt = b.availableAt ? Date.parse(b.availableAt) : 0
    return bAt - aAt || a.id.localeCompare(b.id)
  })

  const upcomingCandidates = input.sessions
    .filter(session => {
      if (session.observedState === "live" || session.observedState === "ended") return false
      if (session.observedState === "failed") return false
      if (session.desiredState === "failed" || session.desiredState === "cancelled" || session.desiredState === "ended") return false
      const scheduled = toDate(session.scheduledStartAt)
      return !!scheduled && scheduled.getTime() > now.getTime()
    })
    .sort((a, b) => {
      const aAt = toDate(a.scheduledStartAt)?.getTime() ?? 0
      const bAt = toDate(b.scheduledStartAt)?.getTime() ?? 0
      return aAt - bAt || a.sessionNumber - b.sessionNumber
    })
  const upcomingAt = upcomingCandidates[0] ? toIso(upcomingCandidates[0].scheduledStartAt) : null

  const legacyLive = live ? null : buildLegacyLiveItem(input.legacy ?? { status: null, source: null, url: null })

  const state: BroadcastPlaybackState = live || legacyLive
    ? "live"
    : replays.length > 0
      ? "replay"
      : upcomingAt
        ? "upcoming"
        : "unavailable"

  return {
    state,
    live: live ?? legacyLive,
    upcomingAt,
    replays,
    highlights,
  }
}
