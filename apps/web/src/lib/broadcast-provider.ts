import type {
  BroadcastDestinationKind,
  BroadcastObservedState,
  BroadcastProvider,
} from "@mtk/contracts"
import { broadcastObservedFromProvider } from "@mtk/contracts"

/**
 * ENH-08-01/02: server-only provider adapters.
 *
 * These functions build the exact provider request, parse only allowlisted
 * response fields and classify failures. They never write to the database and
 * are always called by the durable worker outside a transaction.
 *
 * A prepare may be retried after a lost response. YouTube broadcasts carry a
 * stable session marker in their description and are adopted instead of
 * recreated. Facebook pages are searched for the same marker before creating a
 * new live video. Nothing here can prove an account/embed was approved.
 */

export type BroadcastCredential = {
  accessToken: string
}

export type BroadcastProviderRequest = {
  provider: BroadcastProvider
  accessToken: string
  destinationExternalId: string
  destinationKind: BroadcastDestinationKind
  providerBroadcastId: string | null
  providerStreamId: string | null
  playbackVideoId: string | null
  /** Stable, non-secret session marker used for lost-response reconciliation. */
  marker: string
  title: string
  scheduledStartAt: Date | null
  fetchImpl?: typeof fetch
}

export type BroadcastIngest = {
  rtmpUrl: string
  streamKey: string
}

export type BroadcastProviderObservation = {
  /** null means the provider answered but its state was not allowlisted. */
  observed: BroadcastObservedState | null
  providerBroadcastId: string | null
  providerStreamId: string | null
  playbackVideoId: string | null
  playbackAvailable: boolean
  ingest: BroadcastIngest | null
  providerMetadata: Record<string, unknown>
  startedAt: Date | null
  endedAt: Date | null
  archive: {
    providerVideoId: string
    status: "pending" | "processing" | "ready" | "failed" | "expired"
    durationSeconds: number | null
    availableAt: Date | null
    retentionUntil: Date | null
  } | null
}

export class BroadcastProviderError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly partial: {
    providerBroadcastId?: string | null
    providerStreamId?: string | null
    playbackVideoId?: string | null
    ingest?: BroadcastIngest | null
  }

  constructor(code: string, options: {
    retryable?: boolean
    partial?: BroadcastProviderError["partial"]
  } = {}) {
    super(code)
    this.name = "BroadcastProviderError"
    this.code = code
    this.retryable = options.retryable ?? false
    this.partial = options.partial ?? {}
  }
}

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3"
const FACEBOOK_API = "https://graph.facebook.com/v23.0"

function fetchFor(request: BroadcastProviderRequest): typeof fetch {
  return request.fetchImpl ?? fetch
}

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(15_000)
  } catch {
    return undefined
  }
}

function classifyHttpStatus(status: number): string {
  if (status === 401) return "credentials_expired"
  if (status === 403) return "provider_refused"
  if (status === 404) return "destination_not_found"
  if (status === 408) return "provider_timeout"
  if (status === 409) return "provider_refused"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "provider_5xx"
  if (status >= 400) return "invalid_request"
  return "provider_refused"
}

function isRetryableCode(code: string): boolean {
  return ["provider_timeout", "provider_5xx", "rate_limited", "transport_uncertain", "unreadable_response"]
    .includes(code)
}

async function requestJson(
  input: BroadcastProviderRequest,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchFor(input)(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? timeoutSignal(),
      redirect: "error",
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
    const code = timedOut ? "provider_timeout" : "transport_uncertain"
    throw new BroadcastProviderError(code, { retryable: true })
  }

  if (!response.ok) {
    const code = classifyHttpStatus(response.status)
    throw new BroadcastProviderError(code, { retryable: isRetryableCode(code) })
  }
  try {
    return await response.json()
  } catch {
    throw new BroadcastProviderError("unreadable_response", { retryable: true })
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isoDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  const total = Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600
    + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
  return Number.isFinite(total) && total >= 0 ? Math.round(total) : null
}

function splitIngestUrl(value: string | null): BroadcastIngest | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!["rtmp:", "rtmps:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null
  const parts = url.pathname.split("/").filter(Boolean)
  const streamKey = parts.at(-1)
  if (!streamKey) return null
  parts.pop()
  const base = `${url.protocol}//${url.host}${parts.length ? `/${parts.join("/")}` : ""}`
  return { rtmpUrl: base, streamKey }
}

function youtubeLifecycle(raw: unknown): BroadcastObservedState | null {
  if (typeof raw !== "string") return null
  return broadcastObservedFromProvider("youtube", raw)
}

function youtubeBroadcastStatus(response: unknown): {
  id: string | null
  observed: BroadcastObservedState | null
  videoId: string | null
  startedAt: Date | null
  endedAt: Date | null
  metadata: Record<string, unknown>
} {
  const root = record(response)
  const item = Array.isArray(root?.items) ? record(root.items[0]) : null
  const status = record(item?.status)
  const snippet = record(item?.snippet)
  const id = stringValue(item?.id)
  const lifecycle = youtubeLifecycle(status?.lifeCycleStatus) ?? youtubeLifecycle(status?.broadcastStatus)
  return {
    id,
    observed: lifecycle,
    videoId: id,
    startedAt: dateValue(snippet?.actualStartTime),
    endedAt: dateValue(snippet?.actualEndTime),
    metadata: {
      provider: "youtube",
      ...(stringValue(status?.broadcastStatus) ? { broadcastStatus: stringValue(status?.broadcastStatus) } : {}),
      ...(stringValue(status?.lifeCycleStatus) ? { lifeCycleStatus: stringValue(status?.lifeCycleStatus) } : {}),
    },
  }
}

async function findYouTubeBroadcast(
  input: BroadcastProviderRequest,
  marker: string,
): Promise<{ id: string; observed: BroadcastObservedState | null } | null> {
  const response = await requestJson(input,
    `${YOUTUBE_API}/liveBroadcasts?part=id,snippet,status&mine=true&broadcastStatus=all&maxResults=50`)
  const root = record(response)
  const items = Array.isArray(root?.items) ? root.items : []
  for (const raw of items) {
    const item = record(raw)
    const description = stringValue(record(item?.snippet)?.description) ?? ""
    if (!description.includes(marker)) continue
    const id = stringValue(item?.id)
    if (!id) continue
    const parsed = youtubeBroadcastStatus({ items: [item] })
    return { id, observed: parsed.observed }
  }
  return null
}

async function prepareYouTube(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  let broadcastId = input.providerBroadcastId
  let observed: BroadcastObservedState | null = null

  if (!broadcastId) {
    // A previous create may have succeeded after the response was lost.
    const adopted = await findYouTubeBroadcast(input, input.marker)
    if (adopted) {
      broadcastId = adopted.id
      observed = adopted.observed
    }
  }

  if (!broadcastId) {
    const scheduled = input.scheduledStartAt && input.scheduledStartAt.getTime() > Date.now()
      ? input.scheduledStartAt
      : new Date()
    let response: unknown
    try {
      response = await requestJson(input, `${YOUTUBE_API}/liveBroadcasts?part=snippet,status,contentDetails`, {
        method: "POST",
        body: JSON.stringify({
          snippet: {
            title: input.title.slice(0, 100),
            description: `SSL broadcast ${input.marker}`,
            scheduledStartTime: scheduled.toISOString(),
          },
          status: { privacyStatus: "unlisted" },
          // Start/End are explicit operator transitions. Auto-start would let a
          // pushed encoder go live without the owner's Start and without any
          // observed update until the next reconcile.
          contentDetails: { enableAutoStart: false, enableAutoStop: false, latencyPreference: "low" },
        }),
      })
    } catch (error) {
      if (error instanceof BroadcastProviderError) throw error
      throw new BroadcastProviderError("provider_refused")
    }
    const created = youtubeBroadcastStatus({ items: [response] })
    broadcastId = created.id
    observed = created.observed
    if (!broadcastId) throw new BroadcastProviderError("unreadable_response", { retryable: true })
  }

  let streamId = input.providerStreamId
  let ingest: BroadcastIngest | null = null
  if (!streamId) {
    let streamResponse: unknown
    try {
      streamResponse = await requestJson(input, `${YOUTUBE_API}/liveStreams?part=snippet,cdn,status`, {
        method: "POST",
        body: JSON.stringify({
          snippet: { title: `SSL ingest ${input.marker}`.slice(0, 100) },
          cdn: { ingestionType: "rtmp", frameRate: "variable", resolution: "variable" },
        }),
      })
    } catch (error) {
      if (error instanceof BroadcastProviderError) {
        throw new BroadcastProviderError(error.code, {
          retryable: error.retryable,
          partial: { providerBroadcastId: broadcastId },
        })
      }
      throw new BroadcastProviderError("provider_refused", {
        partial: { providerBroadcastId: broadcastId },
      })
    }
    const stream = record(streamResponse)
    streamId = stringValue(stream?.id)
    const cdn = record(stream?.cdn)
    const ingestion = record(cdn?.ingestionInfo)
    ingest = {
      rtmpUrl: stringValue(ingestion?.ingestionAddress) ?? "",
      streamKey: stringValue(ingestion?.streamName) ?? "",
    }
    if (!ingest.rtmpUrl || !ingest.streamKey) ingest = null
    if (!streamId || !ingest) {
      // Do not persist a half-read stream id: a retry must create a fresh
      // stream with a usable ingest key rather than bind an unknown one.
      throw new BroadcastProviderError("unreadable_response", {
        retryable: true,
        partial: { providerBroadcastId: broadcastId },
      })
    }
  }

  // Binding is idempotent on the provider: binding an already-bound pair is a
  // no-op. A lost bind response is therefore safe to retry.
  try {
    const bindResponse = await requestJson(input,
      `${YOUTUBE_API}/liveBroadcasts/bind?part=id,status&id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}`,
      { method: "POST" })
    const bound = youtubeBroadcastStatus({ items: [bindResponse] })
    if (bound.observed) observed = bound.observed
  } catch (error) {
    if (error instanceof BroadcastProviderError) {
      throw new BroadcastProviderError(error.code, {
        retryable: error.retryable,
        partial: { providerBroadcastId: broadcastId, providerStreamId: streamId, ingest },
      })
    }
    throw new BroadcastProviderError("provider_refused", {
      partial: { providerBroadcastId: broadcastId, providerStreamId: streamId, ingest },
    })
  }

  return {
    // No life-cycle status is not proof of readiness. Let the follow-up
    // reconcile confirm it instead of inventing a startable broadcast.
    observed: observed ?? "provisioning",
    providerBroadcastId: broadcastId,
    providerStreamId: streamId,
    playbackVideoId: broadcastId,
    playbackAvailable: observed === "live",
    ingest,
    providerMetadata: { provider: "youtube" },
    startedAt: null,
    endedAt: null,
    archive: null,
  }
}

async function startYouTube(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  if (!input.providerBroadcastId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${YOUTUBE_API}/liveBroadcasts/transition?part=id,status&id=${encodeURIComponent(input.providerBroadcastId)}&broadcastStatus=live`,
    { method: "POST" })
  const parsed = youtubeBroadcastStatus({ items: [response] })
  return {
    observed: parsed.observed ?? "provisioning",
    providerBroadcastId: parsed.id ?? input.providerBroadcastId,
    providerStreamId: input.providerStreamId,
    playbackVideoId: parsed.id ?? input.playbackVideoId ?? input.providerBroadcastId,
    playbackAvailable: parsed.observed === "live",
    ingest: null,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    archive: null,
  }
}

async function endYouTube(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  if (!input.providerBroadcastId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${YOUTUBE_API}/liveBroadcasts/transition?part=id,status&id=${encodeURIComponent(input.providerBroadcastId)}&broadcastStatus=complete`,
    { method: "POST" })
  const parsed = youtubeBroadcastStatus({ items: [response] })
  return {
    observed: parsed.observed ?? "ending",
    providerBroadcastId: parsed.id ?? input.providerBroadcastId,
    providerStreamId: input.providerStreamId,
    playbackVideoId: parsed.id ?? input.playbackVideoId ?? input.providerBroadcastId,
    playbackAvailable: false,
    ingest: null,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    archive: null,
  }
}

async function reconcileYouTube(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  if (input.providerBroadcastId) {
    const response = await requestJson(input,
      `${YOUTUBE_API}/liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(input.providerBroadcastId)}`)
    const parsed = youtubeBroadcastStatus(response)
    return {
      observed: parsed.observed,
      providerBroadcastId: parsed.id ?? input.providerBroadcastId,
      providerStreamId: input.providerStreamId,
      playbackVideoId: parsed.videoId ?? input.playbackVideoId,
      playbackAvailable: parsed.observed === "live",
      ingest: null,
      providerMetadata: parsed.metadata,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      archive: null,
    }
  }

  const videoId = input.playbackVideoId
  if (!videoId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${YOUTUBE_API}/videos?part=id,snippet,status,liveStreamingDetails,contentDetails&id=${encodeURIComponent(videoId)}`)
  const root = record(response)
  const item = Array.isArray(root?.items) ? record(root.items[0]) : null
  if (!item) throw new BroadcastProviderError("destination_not_found")
  const snippet = record(item.snippet)
  const status = record(item.status)
  const live = record(item.liveStreamingDetails)
  const content = stringValue(snippet?.liveBroadcastContent)
  const startedAt = dateValue(live?.actualStartTime)
  const endedAt = dateValue(live?.actualEndTime)
  const processed = stringValue(status?.uploadStatus) === "processed"

  let observed: BroadcastObservedState | null = null
  if (content === "live") observed = "live"
  else if (content === "upcoming") observed = "provisioning"
  else if (endedAt) observed = processed ? "replay_ready" : "processing"
  else if (stringValue(status?.uploadStatus) === "failed") observed = "failed"

  const archive = endedAt
    ? {
      providerVideoId: videoId,
      status: (processed ? "ready" : "processing") as "ready" | "processing",
      durationSeconds: isoDurationSeconds(record(item.contentDetails)?.duration),
      availableAt: endedAt,
      retentionUntil: null,
    }
    : null

  return {
    observed,
    providerBroadcastId: null,
    providerStreamId: input.providerStreamId,
    playbackVideoId: videoId,
    playbackAvailable: observed === "live",
    ingest: null,
    providerMetadata: {
      provider: "youtube",
      ...(content ? { liveBroadcastContent: content } : {}),
      ...(stringValue(status?.uploadStatus) ? { uploadStatus: stringValue(status?.uploadStatus) } : {}),
    },
    startedAt,
    endedAt,
    archive,
  }
}

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------

function facebookStatus(response: unknown): {
  id: string | null
  observed: BroadcastObservedState | null
  startedAt: Date | null
  endedAt: Date | null
  metadata: Record<string, unknown>
  ingest: BroadcastIngest | null
} {
  const item = record(response)
  const rawStatus = stringValue(item?.status)
  const observed = rawStatus ? broadcastObservedFromProvider("facebook", rawStatus) : null
  const ingest = splitIngestUrl(stringValue(item?.secure_stream_url) ?? stringValue(item?.stream_url))
  return {
    id: stringValue(item?.id),
    observed,
    startedAt: dateValue(item?.creation_time),
    endedAt: observed === "ended" || observed === "processing" || observed === "replay_ready"
      ? dateValue(item?.updated_time)
      : null,
    metadata: {
      provider: "facebook",
      ...(rawStatus ? { status: rawStatus } : {}),
    },
    ingest,
  }
}

async function findFacebookLiveVideo(
  input: BroadcastProviderRequest,
): Promise<{ id: string; observed: BroadcastObservedState | null } | null> {
  const response = await requestJson(input,
    `${FACEBOOK_API}/${encodeURIComponent(input.destinationExternalId)}/live_videos?fields=id,title,description,status&limit=50`)
  const root = record(response)
  const items = Array.isArray(root?.data) ? root.data : []
  for (const raw of items) {
    const item = record(raw)
    const description = stringValue(item?.description) ?? ""
    if (!description.includes(input.marker)) continue
    const id = stringValue(item?.id)
    if (id) return { id, observed: null }
  }
  return null
}

async function prepareFacebook(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  let videoId = input.providerBroadcastId
  if (!videoId) {
    const adopted = await findFacebookLiveVideo(input)
    videoId = adopted?.id ?? null
  }
  if (!videoId) {
    const response = await requestJson(input,
      `${FACEBOOK_API}/${encodeURIComponent(input.destinationExternalId)}/live_videos`, {
      method: "POST",
      body: JSON.stringify({
        title: input.title.slice(0, 200),
        description: `SSL broadcast ${input.marker}`,
        status: "UNPUBLISHED",
      }),
    })
    const item = record(response)
    videoId = stringValue(item?.id)
    if (!videoId) throw new BroadcastProviderError("unreadable_response", { retryable: true })
  }

  let detail: unknown
  try {
    detail = await requestJson(input,
      `${FACEBOOK_API}/${encodeURIComponent(videoId)}?fields=id,status,stream_url,secure_stream_url,permalink_url,creation_time,updated_time`)
  } catch (error) {
    if (error instanceof BroadcastProviderError) {
      throw new BroadcastProviderError(error.code, {
        retryable: error.retryable,
        partial: { providerBroadcastId: videoId },
      })
    }
    throw new BroadcastProviderError("provider_refused", {
      partial: { providerBroadcastId: videoId },
    })
  }
  const parsed = facebookStatus(detail)
  return {
    observed: parsed.observed ?? "provisioning",
    providerBroadcastId: videoId,
    providerStreamId: null,
    playbackVideoId: videoId,
    playbackAvailable: parsed.observed === "live",
    ingest: parsed.ingest,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    archive: null,
  }
}

async function startFacebook(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  if (!input.providerBroadcastId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${FACEBOOK_API}/${encodeURIComponent(input.providerBroadcastId)}`, {
    method: "POST",
    body: JSON.stringify({ status: "LIVE_NOW" }),
  })
  const parsed = facebookStatus(response)
  return {
    observed: parsed.observed ?? "provisioning",
    providerBroadcastId: parsed.id ?? input.providerBroadcastId,
    providerStreamId: null,
    playbackVideoId: parsed.id ?? input.playbackVideoId ?? input.providerBroadcastId,
    playbackAvailable: parsed.observed === "live",
    ingest: null,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    archive: null,
  }
}

async function endFacebook(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  if (!input.providerBroadcastId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${FACEBOOK_API}/${encodeURIComponent(input.providerBroadcastId)}`, {
    method: "POST",
    body: JSON.stringify({ end_live_video: true }),
  })
  const parsed = facebookStatus(response)
  return {
    observed: parsed.observed ?? "ending",
    providerBroadcastId: parsed.id ?? input.providerBroadcastId,
    providerStreamId: null,
    playbackVideoId: parsed.id ?? input.playbackVideoId ?? input.providerBroadcastId,
    playbackAvailable: false,
    ingest: null,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    archive: null,
  }
}

async function reconcileFacebook(input: BroadcastProviderRequest): Promise<BroadcastProviderObservation> {
  const videoId = input.providerBroadcastId ?? input.playbackVideoId
  if (!videoId) throw new BroadcastProviderError("invalid_request")
  const response = await requestJson(input,
    `${FACEBOOK_API}/${encodeURIComponent(videoId)}?fields=id,status,stream_url,secure_stream_url,permalink_url,creation_time,updated_time`)
  const parsed = facebookStatus(response)
  const endedAt = parsed.endedAt
  const processing = parsed.observed === "processing" || parsed.observed === "replay_ready"
  const archive = processing && endedAt
    ? {
      providerVideoId: videoId,
      status: (parsed.observed === "replay_ready" ? "ready" : "processing") as "ready" | "processing",
      durationSeconds: null,
      availableAt: endedAt,
      // Meta's published policy removes new live recordings after 30 days.
      // Code cannot extend provider retention, so the catalogue fails closed
      // at that boundary even before the provider does.
      retentionUntil: new Date(endedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    }
    : null
  return {
    observed: parsed.observed,
    providerBroadcastId: parsed.id ?? videoId,
    providerStreamId: null,
    playbackVideoId: parsed.id ?? videoId,
    playbackAvailable: parsed.observed === "live",
    ingest: null,
    providerMetadata: parsed.metadata,
    startedAt: parsed.startedAt,
    endedAt,
    archive,
  }
}

// ---------------------------------------------------------------------------
// Public adapter surface
// ---------------------------------------------------------------------------

export async function prepareBroadcast(
  input: BroadcastProviderRequest,
): Promise<BroadcastProviderObservation> {
  return input.provider === "youtube" ? prepareYouTube(input) : prepareFacebook(input)
}

export async function startBroadcast(
  input: BroadcastProviderRequest,
): Promise<BroadcastProviderObservation> {
  return input.provider === "youtube" ? startYouTube(input) : startFacebook(input)
}

export async function endBroadcast(
  input: BroadcastProviderRequest,
): Promise<BroadcastProviderObservation> {
  return input.provider === "youtube" ? endYouTube(input) : endFacebook(input)
}

export async function reconcileBroadcast(
  input: BroadcastProviderRequest,
): Promise<BroadcastProviderObservation> {
  return input.provider === "youtube" ? reconcileYouTube(input) : reconcileFacebook(input)
}
