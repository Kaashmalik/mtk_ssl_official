"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@mtk/ui/components/ui/dialog"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Video } from "lucide-react"
import { startStream, endStream } from "@/app/actions/matches"
import { toast } from "sonner"
import { resolveActionError } from "@/lib/plan-limit-error"
import { PlanLimitNotice } from "@/components/billing/plan-limit-notice"
import type { PlanLimitDetail } from "@mtk/database"

export function StreamStartModal({ matchId, currentStatus }: { matchId: string; currentStatus: string }) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<"facebook" | "youtube" | "rtmp" | "webrtc">("facebook")
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  // Live streaming is a paid capability; keep the dialog open on a plan block so
  // the upgrade path stays visible instead of flashing a toast and closing.
  const [planLimit, setPlanLimit] = useState<PlanLimitDetail | null>(null)

  if (currentStatus === "live") {
    return (
      <Button
        variant="destructive"
        size="sm"
        disabled={loading}
        onClick={async () => {
          setLoading(true)
          try {
            await endStream(matchId)
            toast.success("Stream ended")
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to end stream")
          } finally {
            setLoading(false)
          }
        }}
      >
        End Stream
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Video className="h-4 w-4 mr-2" /> Go Live
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Live Stream</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {planLimit && <PlanLimitNotice detail={planLimit} />}
          <div className="space-y-2">
            <Label htmlFor="stream-source">Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
              <SelectTrigger id="stream-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="facebook">Facebook Live</SelectItem>
                <SelectItem value="youtube">YouTube Live</SelectItem>
                <SelectItem value="rtmp">RTMP (OBS)</SelectItem>
                <SelectItem value="webrtc">WebRTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stream-url">Stream URL</Label>
            <Input
              id="stream-url"
              placeholder="https://www.facebook.com/watch/live/... or https://youtu.be/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={loading || !url}
            onClick={async () => {
              setLoading(true)
              setPlanLimit(null)
              try {
                await startStream(matchId, source, url)
                toast.success("Stream started")
                setOpen(false)
              } catch (e) {
                const resolved = resolveActionError(e, "Failed to start stream")
                setPlanLimit(resolved.planLimit)
                if (!resolved.planLimit) toast.error(resolved.message)
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? "Starting..." : "Go Live"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
