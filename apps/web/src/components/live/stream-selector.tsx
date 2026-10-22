"use client"

import { useMemo, useState } from "react"
import { Play } from "lucide-react"
import type {
  BroadcastPlaybackCatalogue,
  BroadcastPlaybackItem,
} from "@mtk/contracts"
import { ProviderVideoEmbed } from "./provider-video-embed"

function formatUtc(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  // Deterministic server/client output (no locale or local-time hydration drift).
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function videoLabel(
  item: BroadcastPlaybackItem,
  catalogue: BroadcastPlaybackCatalogue,
): string {
  if (item.kind === "live") return "Live"
  if (item.kind === "highlights") return item.title
  const index = catalogue.replays.findIndex(replay => replay.id === item.id)
  return catalogue.replays.length > 1 ? `Replay ${index + 1}` : "Replay"
}

/**
 * ENH-08-03: public Live / Upcoming / Replays / Highlights surface.
 *
 * Every item is already a truthful, host-validated projection from the shared
 * contract. This component only chooses what to display; it never infers a
 * replay from an ended legacy URL or claims a prepared stream is live.
 */
export function StreamSelector({ catalogue }: { catalogue: BroadcastPlaybackCatalogue }) {
  const videos = useMemo(() => {
    const items: BroadcastPlaybackItem[] = []
    if (catalogue.live) items.push(catalogue.live)
    items.push(...catalogue.replays, ...catalogue.highlights)
    return items
  }, [catalogue])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = videos.find(item => item.id === selectedId) ?? videos[0] ?? null

  if (!selected) {
    const startsAt = formatUtc(catalogue.upcomingAt)
    return (
      <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm px-4 text-center">
        {startsAt ? (
          <>
            <span className="font-medium text-foreground">Stream scheduled</span>
            <time dateTime={catalogue.upcomingAt ?? undefined}>{startsAt}</time>
            <span className="text-xs">The player appears only after the provider confirms the stream is live.</span>
          </>
        ) : (
          <span>Stream has not started yet</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ProviderVideoEmbed item={selected} />

      {videos.length > 1 && (
        <div role="group" aria-label="Available videos" className="flex flex-wrap gap-2">
          {videos.map(item => {
            const active = item.id === selected.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(item.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {videoLabel(item, catalogue)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
