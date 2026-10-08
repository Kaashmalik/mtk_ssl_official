"use client"

import { useState } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@mtk/ui"
import { Share2, Link, MessageCircle, Twitter, Facebook, Check } from "lucide-react"
import { toast } from "sonner"

interface ShareButtonProps {
  matchId: string
  teamAName: string
  teamBName: string
  resultText: string
}

export function ShareButton({ matchId, teamAName, teamBName, resultText }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  const shareText = `🏏 SSL Match Update: ${teamAName} vs ${teamBName} - ${resultText}`
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/dashboard/matches/${matchId}` : ""

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Shakir Super League Scorecard",
          text: shareText,
          url: publicUrl,
        })
        toast.success("Shared successfully!")
      } catch (err: any) {
        if (err.name !== "AbortError") {
          toast.error("Error sharing content")
        }
      }
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      toast.success("Link copied to clipboard!")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy link")
    }
  }

  const handleWhatsAppShare = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(`${shareText}\nView Scorecard: ${publicUrl}`)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleTwitterShare = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(publicUrl)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleFacebookShare = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(publicUrl)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share

  return (
    <div className="flex gap-2">
      {hasNativeShare ? (
        <Button onClick={handleNativeShare} variant="outline" size="sm" className="h-8 text-xs gap-1.5 border-white/20 text-white bg-white/10 hover:bg-white/20">
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 border-white/20 text-white bg-white/10 hover:bg-white/20">
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleCopyLink} className="gap-2 text-xs cursor-pointer">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Link className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy Link"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWhatsAppShare} className="gap-2 text-xs cursor-pointer">
              <MessageCircle className="h-3.5 w-3.5 text-green-500 fill-green-500/20" />
              Share to WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTwitterShare} className="gap-2 text-xs cursor-pointer">
              <Twitter className="h-3.5 w-3.5 text-sky-400 fill-sky-400/20" />
              Share to Twitter/X
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleFacebookShare} className="gap-2 text-xs cursor-pointer">
              <Facebook className="h-3.5 w-3.5 text-blue-600 fill-blue-600/20" />
              Share to Facebook
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
