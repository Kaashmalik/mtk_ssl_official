"use client"

import { useMemo } from "react"
import {
  buildLegacyFacebookEmbedUrl,
  buildProviderPlaybackUrls,
  parseFacebookVideoId,
} from "@mtk/contracts"

/**
 * Compatibility wrapper for existing callers. A numeric Facebook video id is
 * preferred; a legacy live URL is accepted only after the exact https host
 * allowlist, and it is embedded through Facebook's own plugin.
 */
export function FacebookLiveEmbed({ url }: { url: string }) {
  const src = useMemo(() => {
    const videoId = parseFacebookVideoId(url)
    if (videoId) return buildProviderPlaybackUrls("facebook", videoId)?.embedUrl ?? ""
    return buildLegacyFacebookEmbedUrl(url)?.embedUrl ?? ""
  }, [url])

  if (!src) {
    return <div className="aspect-video bg-black/80 rounded-lg flex items-center justify-center text-white/60 text-sm">Invalid Facebook URL</div>
  }
  return (
    <iframe
      src={src}
      className="w-full aspect-video rounded-lg"
      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      title="Facebook Live"
    />
  )
}
