"use client"

import { useMemo } from "react"

function toYouTubeEmbed(url: string): string {
  try {
    const u = new URL(url)
    let id = ""
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1)
    else if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/live/")) id = u.pathname.split("/live/")[1].split("/")[0]
      else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/embed/")[1].split("/")[0]
      else id = u.searchParams.get("v") ?? ""
    }
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` : ""
  } catch {
    return ""
  }
}

export function YouTubeLiveEmbed({ url }: { url: string }) {
  const src = useMemo(() => toYouTubeEmbed(url), [url])
  if (!src) {
    return <div className="aspect-video bg-black/80 rounded-lg flex items-center justify-center text-white/60 text-sm">Invalid YouTube URL</div>
  }
  return (
    <iframe
      src={src}
      className="w-full aspect-video rounded-lg"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      title="YouTube Live"
    />
  )
}
