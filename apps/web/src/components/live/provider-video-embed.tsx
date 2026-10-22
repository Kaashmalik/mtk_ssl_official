"use client"

import { ExternalLink } from "lucide-react"
import {
  isAllowedProviderEmbedUrl,
  type BroadcastPlaybackItem,
  type BroadcastProvider,
} from "@mtk/contracts"

const PROVIDER_LABEL: Record<BroadcastProvider, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
}

/**
 * ENH-08-03: the ONE public provider embed.
 *
 * The embed URL is produced by `@mtk/contracts` from a validated provider id
 * (or an allowlisted legacy Facebook URL). This component re-validates it so a
 * future caller cannot pass an arbitrary iframe origin, and the provider's own
 * player/chrome/ads are never covered or masked.
 */
export function ProviderVideoEmbed({ item }: { item: BroadcastPlaybackItem }) {
  if (!isAllowedProviderEmbedUrl(item.embedUrl)) {
    return (
      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center text-muted-foreground text-sm">
        This provider link cannot be embedded safely.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <iframe
        src={item.embedUrl}
        className="w-full aspect-video rounded-lg bg-black"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        title={`${PROVIDER_LABEL[item.provider]} - ${item.title}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Video hosted by {PROVIDER_LABEL[item.provider]}
          {item.legacy ? " (legacy stream link, not a verified archive)" : ""}
        </span>
        <a
          href={item.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          Open on {PROVIDER_LABEL[item.provider]}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
