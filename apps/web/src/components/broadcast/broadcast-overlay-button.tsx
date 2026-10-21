"use client"

import { useState } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@mtk/ui/components/ui/dialog"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { MonitorPlay, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"

/**
 * ENH-09-01: issue a read-only OBS URL. The token is minted server-side and is
 * bounded to four hours by default; the dialog says so rather than implying a
 * permanent public link.
 */
export function BroadcastOverlayButton({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [overlayUrl, setOverlayUrl] = useState("")
  const [expiresAt, setExpiresAt] = useState("")

  async function issue() {
    setLoading(true)
    try {
      const response = await fetch(`/api/broadcast/overlay/${encodeURIComponent(matchId)}/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttlSeconds: 4 * 60 * 60 }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(detail.error || "Could not create overlay link")
      }
      const data = await response.json() as { url: string; expiresAt: string }
      setOverlayUrl(data.url)
      setExpiresAt(data.expiresAt)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create overlay link")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next && !overlayUrl) void issue()
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MonitorPlay className="mr-2 h-4 w-4" /> OBS Overlay
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Broadcast overlay</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste this URL into an OBS Browser Source at 1920×1080. It is read-only,
            expires at {expiresAt ? new Date(expiresAt).toLocaleString() : "four hours"},
            and stops showing data if the match is unpublished.
          </p>
          {overlayUrl ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="overlay-url">Overlay URL</Label>
                <Input id="overlay-url" readOnly value={overlayUrl} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(overlayUrl)
                      toast.success("Overlay URL copied")
                    } catch {
                      toast.error("Could not copy the URL")
                    }
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
                <Button asChild className="flex-1">
                  <a href={overlayUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Open
                  </a>
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={() => void issue()}
              >
                {loading ? "Rotating..." : "Issue a fresh URL"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {loading ? "Minting a read-only link…" : "No overlay link has been issued."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
