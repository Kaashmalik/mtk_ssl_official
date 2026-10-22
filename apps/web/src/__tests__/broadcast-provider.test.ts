import { describe, expect, it, vi } from "vitest"
import {
  BroadcastProviderError,
  endBroadcast,
  prepareBroadcast,
  reconcileBroadcast,
  startBroadcast,
  type BroadcastProviderRequest,
} from "@/lib/broadcast-provider"

/**
 * ENH-08-01/02: provider request shape and failure classification.
 *
 * These are adapter tests against a mocked fetch. They do not claim YouTube or
 * Facebook acceptance; they pin that the worker sends exact allowlisted
 * requests, never leaks a token into a URL, and cannot invent live from a
 * non-live provider answer.
 */

const SESSION = "00000000-0000-4000-8000-0000000000a1"
const PAGE = "123456789"
const VIDEO = "dQw4w9WgXcQ"

function request(overrides: Partial<BroadcastProviderRequest> = {}): BroadcastProviderRequest {
  return {
    provider: "youtube",
    accessToken: "token-value",
    destinationExternalId: "UC-channel",
    destinationKind: "channel",
    providerBroadcastId: null,
    providerStreamId: null,
    playbackVideoId: null,
    marker: `ssl-session-${SESSION}`,
    title: "SSL live match",
    scheduledStartAt: new Date("2026-10-22T12:00:00Z"),
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("ENH-08-02: YouTube adapter", () => {
  it("creates, streams and binds with an opaque marker and bearer auth", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ id: "broadcast-1", status: { lifeCycleStatus: "created" } }))
      .mockResolvedValueOnce(json({
        id: "stream-1",
        cdn: { ingestionInfo: { ingestionAddress: "rtmp://a.rtmp.youtube.com/live2", streamName: "key-1" } },
      }))
      .mockResolvedValueOnce(json({ id: "broadcast-1", status: { lifeCycleStatus: "ready" } }))

    const result = await prepareBroadcast(request({ fetchImpl }))

    expect(result).toMatchObject({
      observed: "ready",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      ingest: { rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: "key-1" },
    })
    const [listUrl] = fetchImpl.mock.calls[0]
    expect(listUrl).toContain("/liveBroadcasts?")
    expect(listUrl).not.toContain("token-value")
    const createCall = fetchImpl.mock.calls[1]
    expect(createCall[0]).toContain("/liveBroadcasts?part=snippet,status,contentDetails")
    expect(createCall[1].headers.Authorization).toBe("Bearer token-value")
    const createBody = JSON.parse(createCall[1].body)
    expect(createBody.snippet.description).toContain(`ssl-session-${SESSION}`)
    expect(createBody.status.privacyStatus).toBe("unlisted")
    expect(createBody.contentDetails).toMatchObject({ enableAutoStart: false, enableAutoStop: false })
    expect(fetchImpl.mock.calls[3][0]).toContain("liveBroadcasts/bind")
    expect(fetchImpl.mock.calls[3][0]).toContain("streamId=stream-1")
  })

  it("adopts an existing marked broadcast instead of creating a duplicate", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({
        items: [{
          id: "adopted-1",
          snippet: { description: `SSL broadcast ssl-session-${SESSION}` },
          status: { lifeCycleStatus: "ready" },
        }],
      }))
      .mockResolvedValueOnce(json({
        id: "stream-2",
        cdn: { ingestionInfo: { ingestionAddress: "rtmp://a.rtmp.youtube.com/live2", streamName: "key-2" } },
      }))
      .mockResolvedValueOnce(json({ id: "adopted-1", status: { lifeCycleStatus: "ready" } }))

    const result = await prepareBroadcast(request({ fetchImpl }))
    expect(result.providerBroadcastId).toBe("adopted-1")
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("part=snippet,status,contentDetails"))).toBe(false)
  })

  it("keeps the created broadcast id when a later prepare step fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ id: "broadcast-partial", status: { lifeCycleStatus: "created" } }))
      .mockResolvedValueOnce(json({ error: { message: "refused" } }, 403))

    await expect(prepareBroadcast(request({ fetchImpl }))).rejects.toMatchObject({
      code: "provider_refused",
      partial: { providerBroadcastId: "broadcast-partial" },
    })
  })

  it("maps a live transition only when the provider says live", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: "broadcast-1", status: { lifeCycleStatus: "ready" } }))
      .mockResolvedValueOnce(json({ id: "broadcast-1", status: { lifeCycleStatus: "live" } }))

    const pending = await startBroadcast(request({ fetchImpl, providerBroadcastId: "broadcast-1" }))
    expect(pending.observed).toBe("ready")
    expect(pending.playbackAvailable).toBe(false)

    const live = await startBroadcast(request({ fetchImpl, providerBroadcastId: "broadcast-1" }))
    expect(live.observed).toBe("live")
    expect(live.playbackAvailable).toBe(true)
  })

  it("maps an attached ended video to processing, not replay-ready by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({
      items: [{
        id: VIDEO,
        snippet: { liveBroadcastContent: "none" },
        status: { uploadStatus: "uploaded" },
        liveStreamingDetails: { actualStartTime: "2026-10-22T10:00:00Z", actualEndTime: "2026-10-22T11:00:00Z" },
      }],
    }))
    const result = await reconcileBroadcast(request({
      fetchImpl,
      providerBroadcastId: null,
      playbackVideoId: VIDEO,
    }))
    expect(result.observed).toBe("processing")
    expect(result.playbackAvailable).toBe(false)
    expect(result.archive).toMatchObject({ providerVideoId: VIDEO, status: "processing" })
  })

  it("classifies auth, rate-limit and transport failures", async () => {
    const auth = vi.fn().mockResolvedValueOnce(json({ error: "expired" }, 401))
    await expect(startBroadcast(request({ fetchImpl: auth, providerBroadcastId: "b" })))
      .rejects.toMatchObject({ code: "credentials_expired", retryable: false })

    const rate = vi.fn().mockResolvedValueOnce(json({ error: "slow" }, 429))
    await expect(endBroadcast(request({ fetchImpl: rate, providerBroadcastId: "b" })))
      .rejects.toMatchObject({ code: "rate_limited", retryable: true })

    const network = vi.fn().mockRejectedValue(new Error("socket"))
    await expect(endBroadcast(request({ fetchImpl: network, providerBroadcastId: "b" })))
      .rejects.toBeInstanceOf(BroadcastProviderError)
  })
})

describe("ENH-08-01: Facebook adapter", () => {
  it("prepares a page live video and splits the secure ingest URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: PAGE + "01" }))
      .mockResolvedValueOnce(json({
        id: PAGE + "01",
        status: "UNPUBLISHED",
        secure_stream_url: "rtmps://live-api-s.facebook.com:443/rtmp/FB-key-1",
        creation_time: "2026-10-22T10:00:00Z",
      }))

    const result = await prepareBroadcast(request({
      fetchImpl,
      provider: "facebook",
      destinationExternalId: PAGE,
      destinationKind: "page",
    }))
    expect(result).toMatchObject({
      observed: "provisioning",
      providerBroadcastId: PAGE + "01",
      ingest: { rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp", streamKey: "FB-key-1" },
    })
    const create = fetchImpl.mock.calls[1]
    expect(create[0]).toContain(`/${PAGE}/live_videos`)
    expect(create[1].headers.Authorization).toBe("Bearer token-value")
    expect(JSON.parse(create[1].body).description).toContain(`ssl-session-${SESSION}`)
  })

  it("maps a Facebook VOD to a playable replay with a bounded retention", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({
      id: PAGE + "01",
      status: "VOD",
      updated_time: "2026-10-22T11:00:00Z",
    }))
    const result = await reconcileBroadcast(request({
      fetchImpl,
      provider: "facebook",
      destinationExternalId: PAGE,
      destinationKind: "page",
      providerBroadcastId: PAGE + "01",
    }))
    expect(result.observed).toBe("replay_ready")
    expect(result.playbackAvailable).toBe(false)
    expect(result.archive?.status).toBe("ready")
    expect(result.archive?.retentionUntil).toBeInstanceOf(Date)
  })
})
