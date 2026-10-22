"use client"

import { useMemo } from "react"
import { buildProviderPlaybackUrls, parseYouTubeVideoId } from "@mtk/contracts"

/**
 * Compatibility wrapper for existing callers. URL parsing now goes through the
 * ENH-08-03 exact host allowlist (`youtube.com.evil.example` is refused), and
 * the embed URL is built from the validated provider id rather than pasted.
 */
export function YouTubeLiveEmbed({ url }: { url: string }) {
  const src = useMemo(() => {
    const videoId = parseYouTubeVideoId(url)
    return videoId ? buildProviderPlaybackUrls("youtube", videoId)?.embedUrl ?? "" : ""
  }, [url])

  if (!src) {
    return <div className="aspect-video bg-black/80 rounded-lg flex items-center justify-center text-white/60 text-sm">Invalid YouTube URL</div>
  }
  return (
    <iframe
      src={src}
      className="w-full aspect-video rounded-lg"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      title="YouTube Live"
    />
  )
}
