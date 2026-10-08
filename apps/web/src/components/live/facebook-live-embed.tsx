"use client"

import { useMemo } from "react"

export function FacebookLiveEmbed({ url }: { url: string }) {
  const src = useMemo(() => {
    try {
      const u = new URL(url)
      if (u.hostname.includes("facebook.com") || u.hostname.includes("fb.watch")) {
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true&mute=true`
      }
    } catch {
      return ""
    }
    return ""
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
      title="Facebook Live"
    />
  )
}
