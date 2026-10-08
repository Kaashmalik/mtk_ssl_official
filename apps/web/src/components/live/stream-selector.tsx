"use client"

import { FacebookLiveEmbed } from "./facebook-live-embed"
import { YouTubeLiveEmbed } from "./youtube-live-embed"

export function StreamSelector({ source, url }: { source: string | null; url: string | null }) {
  if (!url || !source) {
    return (
      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center text-muted-foreground text-sm">
        Stream has not started yet
      </div>
    )
  }
  if (source === "facebook") return <FacebookLiveEmbed url={url} />
  if (source === "youtube") return <YouTubeLiveEmbed url={url} />
  return (
    <div className="aspect-video bg-muted rounded-lg flex items-center justify-center text-muted-foreground text-sm">
      Stream source "{source}" not embeddable in browser
    </div>
  )
}
