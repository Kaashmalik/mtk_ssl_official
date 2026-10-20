"use client"

import React, { useMemo, useState } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import {
  buildPlatformSupportMessage,
  buildWhatsAppLink,
  PLATFORM_WHATSAPP_DISPLAY,
  type PlatformSupportContext,
} from "@/lib/platform-support"
import { Copy, ExternalLink, MessageCircle } from "lucide-react"

/**
 * ENH-02-04: the privacy-conscious support surface. It always shows the
 * display number and a wa.me link for a MANUAL send: nothing is transmitted
 * by this component, nothing claims a message was sent — WhatsApp opens with
 * the disclosed draft and the user presses Send there. The exact prefilled
 * text is disclosed BEFORE the link is used, and a copy-number fallback
 * covers users without the WhatsApp Scheme handler.
 *
 * Deliberately hideable independently (phase gate): this component is
 * leaf-level and carries no state, so removing/integrating it cannot touch
 * applications, history or approval flows.
 */
export function PlatformContact({
  context,
  className,
}: {
  context: PlatformSupportContext
  className?: string
}) {
  const [showPreview, setShowPreview] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const message = useMemo(() => buildPlatformSupportMessage(context), [context])
  const whatsappHref = useMemo(() => buildWhatsAppLink(message), [message])

  const handleCopyNumber = () => {
    try {
      void navigator.clipboard?.writeText(PLATFORM_WHATSAPP_DISPLAY)
      setCopied(true)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <div className={className ?? "rounded-lg border border-muted bg-muted/20 p-3 text-sm"}>
      <p className="flex items-center gap-2 font-medium">
        <MessageCircle className="h-4 w-4" />
        Platform support on WhatsApp · {PLATFORM_WHATSAPP_DISPLAY}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? "Hide message preview" : "Show message preview"}
        </Button>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
        >
          <ExternalLink className="h-4 w-4" />
          Open WhatsApp with this draft
        </a>
        <Button type="button" variant="ghost" size="sm" onClick={handleCopyNumber}>
          <Copy className="mr-1 h-3 w-3" />
          {copied ? "Copied" : "Copy number"}
        </Button>
      </div>

      {showPreview && (
        <p className="mt-2 whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-muted-foreground">
          {message}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        WhatsApp opens on your device and you send the message yourself — nothing is sent from this page. Avoid
        sharing passwords or verification codes with anyone.
      </p>
      {copyFailed && (
        <p className="mt-1 text-xs text-destructive">Copying failed — the number is shown above; type it into WhatsApp.</p>
      )}
    </div>
  )
}
