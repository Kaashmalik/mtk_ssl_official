"use client"

import { useState } from "react"
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@mtk/ui"
import { Share2, Link, MessageCircle, Twitter, Facebook, Check } from "lucide-react"
import { toast } from "sonner"
import { useTenantBrandName } from "@/components/tenant-brand-name"
import { buildTournamentShareText } from "@/lib/share-texts"

/**
 * FAN-03 public tournament share card. Shares the PUBLIC route only
 * (/tournaments/<id>) - never a dashboard path, so a shared link always
 * lands on the publication-gated surface. Pure text/URL builders are
 * exported for NODE-only copy tests.
 */

export const TOURNAMENT_SHARE_LABELS = {
  trigger: "Share",
  copy: "Copy Link",
  copied: "Copied!",
  whatsapp: "Share to WhatsApp",
  twitter: "Share to Twitter/X",
  facebook: "Share to Facebook",
} as const

export function tournamentSharePath(tournamentId: string): string {
  return `/tournaments/${tournamentId}`
}

export function buildShareUrl(tournamentId: string, origin: string): string {
  return `${origin}${tournamentSharePath(tournamentId)}`
}

export function whatsappShareUrl(text: string, url: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text}\n${url}`)}`
}

export function twitterShareUrl(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}

export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
}

export function TournamentShareCard({
  tournamentId,
  tournamentName,
  championName,
}: {
  tournamentId: string
  tournamentName: string
  championName?: string | null
}) {
  const [copied, setCopied] = useState(false)
  const { short } = useTenantBrandName()
  const shareText = buildTournamentShareText(short, tournamentName, championName)
  const url = typeof window !== "undefined" ? buildShareUrl(tournamentId, window.location.origin) : ""

  async function copyClicked() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied to clipboard!")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy link")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Share2 className="h-3.5 w-3.5" />
          {TOURNAMENT_SHARE_LABELS.trigger}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={copyClicked} className="gap-2 text-xs cursor-pointer">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Link className="h-3.5 w-3.5" />}
          {copied ? TOURNAMENT_SHARE_LABELS.copied : TOURNAMENT_SHARE_LABELS.copy}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => window.open(whatsappShareUrl(shareText, url), "_blank", "noopener,noreferrer")}
          className="gap-2 text-xs cursor-pointer"
        >
          <MessageCircle className="h-3.5 w-3.5 text-green-500 fill-green-500/20" />
          {TOURNAMENT_SHARE_LABELS.whatsapp}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => window.open(twitterShareUrl(shareText, url), "_blank", "noopener,noreferrer")}
          className="gap-2 text-xs cursor-pointer"
        >
          <Twitter className="h-3.5 w-3.5 text-sky-400 fill-sky-400/20" />
          {TOURNAMENT_SHARE_LABELS.twitter}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => window.open(facebookShareUrl(url), "_blank", "noopener,noreferrer")}
          className="gap-2 text-xs cursor-pointer"
        >
          <Facebook className="h-3.5 w-3.5 text-blue-600 fill-blue-600/20" />
          {TOURNAMENT_SHARE_LABELS.facebook}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
