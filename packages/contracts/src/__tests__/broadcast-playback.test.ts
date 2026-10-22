import { describe, expect, it } from "vitest"
import {
  buildBroadcastPlaybackCatalogue,
  buildLegacyFacebookEmbedUrl,
  buildProviderPlaybackUrls,
  isAllowedProviderEmbedUrl,
  parseFacebookVideoId,
  parseYouTubeVideoId,
  type BroadcastArchivePlaybackInput,
  type BroadcastSessionPlaybackInput,
} from "../broadcast-playback"

/**
 * ENH-08-03: the public playback catalogue is truthful and host-allowlisted.
 *
 * The important negatives: a lookalike hostname is not "YouTube", a prepared
 * request is not live, a processing archive is not a replay, an expired
 * retention window is unavailable, and a legacy live URL never becomes a
 * durable replay.
 */

const NOW = new Date("2026-10-21T12:00:00Z")

function session(overrides: Partial<BroadcastSessionPlaybackInput> = {}): BroadcastSessionPlaybackInput {
  return {
    id: "session-1",
    provider: "youtube",
    sessionNumber: 1,
    desiredState: "live",
    observedState: "live",
    playbackVideoId: "dQw4w9WgXcQ",
    playbackAvailable: true,
    scheduledStartAt: "2026-10-21T10:00:00Z",
    startedAt: "2026-10-21T10:05:00Z",
    endedAt: null,
    ...overrides,
  }
}

function archive(overrides: Partial<BroadcastArchivePlaybackInput> = {}): BroadcastArchivePlaybackInput {
  return {
    id: "archive-1",
    sessionId: "session-1",
    providerVideoId: "dQw4w9WgXcQ",
    status: "ready",
    durationSeconds: 7200,
    availableAt: "2026-10-21T11:00:00Z",
    retentionUntil: null,
    metadata: null,
    ...overrides,
  }
}

describe("ENH-08-03: provider URL parsing is host-allowlisted", () => {
  it("accepts documented YouTube shapes and bare ids", () => {
    expect(parseYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeVideoId("https://m.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
  })

  it("refuses lookalike hosts, foreign protocols and malformed ids", () => {
    expect(parseYouTubeVideoId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTubeVideoId("https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTubeVideoId("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTubeVideoId("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=too-short")).toBeNull()
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>")).toBeNull()
  })

  it("parses Facebook numeric ids and refuses lookalike hosts", () => {
    expect(parseFacebookVideoId("123456789012345")).toBe("123456789012345")
    expect(parseFacebookVideoId("https://www.facebook.com/watch/?v=123456789012345")).toBe("123456789012345")
    expect(parseFacebookVideoId("https://web.facebook.com/SomePage/videos/123456789012345/")).toBe("123456789012345")
    expect(parseFacebookVideoId("http://www.facebook.com/watch/?v=123456789012345")).toBeNull()
    expect(parseFacebookVideoId("https://facebook.com.evil.example/watch/?v=123456789012345")).toBeNull()
    expect(parseFacebookVideoId("https://evil.example/facebook.com/watch/?v=123456789012345")).toBeNull()
    expect(parseFacebookVideoId("https://www.facebook.com/watch/?v=not-a-number")).toBeNull()
  })

  it("builds https embeds and rejects a tampered embed URL", () => {
    const youtube = buildProviderPlaybackUrls("youtube", "dQw4w9WgXcQ")
    expect(youtube?.embedUrl).toContain("https://www.youtube.com/embed/dQw4w9WgXcQ")
    expect(youtube?.externalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(youtube?.thumbnailUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")
    expect(isAllowedProviderEmbedUrl(youtube!.embedUrl)).toBe(true)

    const facebook = buildProviderPlaybackUrls("facebook", "123456789012345")
    expect(facebook?.embedUrl).toContain("https://www.facebook.com/plugins/video.php?href=")
    expect(isAllowedProviderEmbedUrl(facebook!.embedUrl)).toBe(true)

    expect(isAllowedProviderEmbedUrl("https://youtube.com.evil.example/embed/dQw4w9WgXcQ")).toBe(false)
    expect(isAllowedProviderEmbedUrl("http://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(false)
    expect(isAllowedProviderEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false)
    expect(buildProviderPlaybackUrls("youtube", "bad")).toBeNull()

    const legacy = buildLegacyFacebookEmbedUrl("https://www.facebook.com/SomePage/live/?ref=bookmarks")
    expect(legacy?.embedUrl).toContain("https://www.facebook.com/plugins/video.php?href=")
    expect(buildLegacyFacebookEmbedUrl("https://facebook.com.evil.example/SomePage/live/")).toBeNull()
  })
})

describe("ENH-08-03: catalogue truth", () => {
  it("shows live only for provider-observed live with an available player", () => {
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session()], archives: [], now: NOW,
    })).toMatchObject({ state: "live", live: { provider: "youtube", kind: "live", legacy: false } })

    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session({ observedState: "ready" })], archives: [], now: NOW,
    }).state).toBe("unavailable")
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session({ playbackAvailable: false })], archives: [], now: NOW,
    }).state).toBe("unavailable")
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session({ playbackVideoId: "not-an-id" })], archives: [], now: NOW,
    }).state).toBe("unavailable")
  })

  it("shows a replay only from a ready, unexpired archive of an ended session", () => {
    const ended = session({ desiredState: "ended", observedState: "replay_ready", endedAt: "2026-10-21T11:00:00Z" })
    const catalogue = buildBroadcastPlaybackCatalogue({
      sessions: [ended], archives: [archive()], now: NOW,
    })
    expect(catalogue.state).toBe("replay")
    expect(catalogue.replays).toHaveLength(1)
    expect(catalogue.replays[0]).toMatchObject({ kind: "replay", providerVideoId: "dQw4w9WgXcQ", durationSeconds: 7200 })

    expect(buildBroadcastPlaybackCatalogue({
      sessions: [ended], archives: [archive({ status: "processing" })], now: NOW,
    }).replays).toEqual([])
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [ended], archives: [archive({ status: "failed" })], now: NOW,
    }).replays).toEqual([])
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [ended], archives: [archive({ retentionUntil: "2026-10-21T11:30:00Z" })], now: NOW,
    }).replays).toEqual([])
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [ended], archives: [archive({ retentionUntil: "not-a-date" })], now: NOW,
    }).replays).toEqual([])
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session()], archives: [archive()], now: NOW,
    }).replays).toEqual([])
  })

  it("prefers a verified live stream over a legacy URL", () => {
    const catalogue = buildBroadcastPlaybackCatalogue({
      sessions: [session()],
      archives: [],
      legacy: { status: "live", source: "youtube", url: "https://youtu.be/aaaaaaaaaaa" },
      now: NOW,
    })
    expect(catalogue.live?.sessionId).toBe("session-1")
    expect(catalogue.live?.legacy).toBe(false)
  })

  it("keeps a legacy live URL embeddable but never calls it a replay", () => {
    const live = buildBroadcastPlaybackCatalogue({
      sessions: [],
      archives: [],
      legacy: { status: "live", source: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
      now: NOW,
    })
    expect(live.state).toBe("live")
    expect(live.live).toMatchObject({ legacy: true, providerVideoId: "dQw4w9WgXcQ" })

    const ended = buildBroadcastPlaybackCatalogue({
      sessions: [],
      archives: [],
      legacy: { status: "ended", source: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
      now: NOW,
    })
    expect(ended.state).toBe("unavailable")
    expect(ended.live).toBeNull()

    const lookalike = buildBroadcastPlaybackCatalogue({
      sessions: [],
      archives: [],
      legacy: { status: "live", source: "youtube", url: "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ" },
      now: NOW,
    })
    expect(lookalike.state).toBe("unavailable")
  })

  it("reports upcoming from a future scheduled session and ignores cancelled ones", () => {
    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session({
        desiredState: "ready",
        observedState: "ready",
        playbackAvailable: false,
        scheduledStartAt: "2026-10-21T14:00:00Z",
      })],
      archives: [],
      now: NOW,
    })).toMatchObject({ state: "upcoming", upcomingAt: "2026-10-21T14:00:00.000Z" })

    expect(buildBroadcastPlaybackCatalogue({
      sessions: [session({
        desiredState: "cancelled",
        observedState: "ready",
        scheduledStartAt: "2026-10-21T14:00:00Z",
      })],
      archives: [],
      now: NOW,
    }).state).toBe("unavailable")
  })

  it("exposes only allowlisted highlight ids from archive metadata", () => {
    const ended = session({ desiredState: "ended", observedState: "replay_ready", endedAt: "2026-10-21T11:00:00Z" })
    const catalogue = buildBroadcastPlaybackCatalogue({
      sessions: [ended],
      archives: [archive({
        metadata: {
          highlights: [
            { videoId: "aaaaaaaaaaa", title: "Final over" },
            { videoId: "https://youtube.com.evil.example/watch?v=bbbbbbbbbbb" },
            { videoId: "too-short" },
          ],
        },
      })],
      now: NOW,
    })
    expect(catalogue.highlights).toHaveLength(1)
    expect(catalogue.highlights[0]).toMatchObject({ providerVideoId: "aaaaaaaaaaa", title: "Final over" })
  })
})
