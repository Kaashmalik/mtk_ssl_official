"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@mtk/ui/components/ui/dialog"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { Copy, Radio, Video } from "lucide-react"
import {
  broadcastCanRevealIngest,
  broadcastOperatorAction,
  type BroadcastControlData,
  type BroadcastSessionSummary,
} from "@mtk/contracts"
import { startStream, endStream } from "@/app/actions/matches"
import {
  attachBroadcast,
  endBroadcast,
  getBroadcastIngest,
  prepareBroadcast,
  refreshBroadcast,
  startBroadcast,
} from "@/app/actions/broadcast"
import { toast } from "sonner"
import { resolveActionError } from "@/lib/plan-limit-error"
import { PlanLimitNotice } from "@/components/billing/plan-limit-notice"
import type { PlanLimitDetail } from "@mtk/database"

type ManualSource = "facebook" | "youtube" | "rtmp" | "webrtc"

function activeSession(sessions: BroadcastSessionSummary[]): BroadcastSessionSummary | null {
  // A live part owns the controls even if a later part was prepared. A failed
  // session stays visible so the owner sees the error and can prepare a fresh
  // part. Ended/cancelled sessions are history, not current controls.
  // A provider-observed live part always needs a visible End control, even if
  // an earlier read recorded an ended intent that the provider has not reached.
  const live = sessions.find(session => session.observedState === "live")
  if (live) return live
  const active = sessions.filter(session =>
    !["ended", "cancelled"].includes(session.desiredState)
    && session.observedState !== "ended")
  return active.at(-1) ?? null
}

function stateLabel(session: BroadcastSessionSummary): string {
  if (session.observedState === "live") return "Provider live"
  if (session.observedState === "ready") return "Provider ready"
  if (session.observedState === "provisioning") return "Provider provisioning"
  if (session.observedState === "replay_ready") return "Replay ready"
  if (session.observedState === "processing") return "Archive processing"
  if (session.observedState === "failed") return "Provider failed"
  if (session.observedState === "interrupted") return "Observation interrupted"
  return `${session.desiredState} / ${session.observedState}`
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          toast.success(`${label} copied`)
        } catch {
          toast.error("Could not copy. Select the value manually.")
        }
      }}
    >
      <Copy className="h-4 w-4 mr-2" /> {label}
    </Button>
  )
}

export function StreamStartModal({
  matchId,
  currentStatus,
  broadcast,
}: {
  matchId: string
  currentStatus: string
  broadcast?: BroadcastControlData
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<ManualSource>("facebook")
  const [url, setUrl] = useState("")
  const [destinationId, setDestinationId] = useState(
    broadcast?.destinations.find(destination => destination.isDefault)?.id
      ?? broadcast?.destinations[0]?.id
      ?? "",
  )
  const [attachUrl, setAttachUrl] = useState("")
  const [mode, setMode] = useState<"prepare" | "attach" | "manual">(
    broadcast?.destinations.length ? "prepare" : "manual",
  )
  const [loading, setLoading] = useState<string | null>(null)
  const [ingest, setIngest] = useState<{
    sessionId: string
    rtmpUrl: string
    streamKey: string
  } | null>(null)
  const [planLimit, setPlanLimit] = useState<PlanLimitDetail | null>(null)

  const sessions = broadcast?.sessions ?? []
  const current = activeSession(sessions)
  const currentAction = current
    ? broadcastOperatorAction({ desired: current.desiredState, observed: current.observedState })
    : "none"
  const destinations = broadcast?.destinations ?? []
  const selectedDestination = destinations.find(destination => destination.id === destinationId)
    ?? destinations[0]
  const attachedCurrent = current?.attached === true

  async function run(label: string, operation: () => Promise<unknown>, success: string) {
    setLoading(label)
    setPlanLimit(null)
    try {
      await operation()
      toast.success(success)
      router.refresh()
    } catch (error) {
      const resolved = resolveActionError(error, "Broadcast action failed")
      setPlanLimit(resolved.planLimit)
      if (!resolved.planLimit) toast.error(resolved.message)
    } finally {
      setLoading(null)
    }
  }

  if (currentStatus === "live" && !current) {
    return (
      <Button
        variant="destructive"
        size="sm"
        disabled={loading !== null}
        onClick={() => run("ending", () => endStream(matchId), "Stream ended")}
      >
        End Stream
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Video className="h-4 w-4 mr-2" /> Live broadcast
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Live broadcast</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {planLimit && <PlanLimitNotice detail={planLimit} />}

          {current && (
            <section className="rounded-lg border p-4 space-y-3" aria-label="Current broadcast session">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={current.observedState === "live" ? "default" : "secondary"}>
                  {stateLabel(current)}
                </Badge>
                <span className="text-sm font-medium">
                  Part {current.sessionNumber} · {current.provider} · {current.destinationName}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Desired {current.desiredState} · observed {current.observedState}
                {current.lastErrorCode ? ` · last error ${current.lastErrorCode}` : ""}
              </p>
              {current.observedState !== "live" && (
                <p className="text-sm text-muted-foreground">
                  A prepared request is not live. Start is available only after the provider
                  confirms ready; the public page never shows live before provider observation.
                  {!current.attached && " Start your encoder in OBS before clicking Start broadcast."}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {currentAction === "start" && (
                  <Button
                    size="sm"
                    disabled={loading !== null}
                    onClick={() => run("starting", () => startBroadcast(matchId, current.id), "Broadcast start requested")}
                  >
                    Start broadcast
                  </Button>
                )}
                {currentAction === "end" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={loading !== null}
                    onClick={() => run("ending", () => endBroadcast(matchId, current.id), "Broadcast end requested")}
                  >
                    {current.attached ? "Stop monitoring" : "End broadcast"}
                  </Button>
                )}
                {currentAction === "wait" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading !== null}
                    onClick={() => run("refreshing", () => refreshBroadcast(matchId, current.id), "Provider status refresh requested")}
                  >
                    Refresh provider status
                  </Button>
                )}
                {!attachedCurrent && broadcastCanRevealIngest({
                  desired: current.desiredState,
                  observed: current.observedState,
                  attached: current.attached,
                }) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading !== null}
                    onClick={() => run("ingest", async () => {
                      const details = await getBroadcastIngest(current.id)
                      setIngest({ sessionId: current.id, ...details })
                    }, "Ingest details unlocked")}
                  >
                    Show ingest details
                  </Button>
                )}
              </div>
              {ingest?.sessionId === current.id && !attachedCurrent && (
                <div className="space-y-2 rounded-md bg-muted p-3">
                  <p className="text-xs font-medium">
                    OBS server and stream key. These are shown only to the league owner.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all rounded bg-background px-2 py-1 text-xs">{ingest.rtmpUrl}</code>
                    <CopyButton value={ingest.rtmpUrl} label="Server" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all rounded bg-background px-2 py-1 text-xs">{ingest.streamKey}</code>
                    <CopyButton value={ingest.streamKey} label="Stream key" />
                  </div>
                </div>
              )}
            </section>
          )}

          {destinations.length > 0 ? (
            <Tabs value={mode} onValueChange={value => setMode(value as typeof mode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="prepare">Prepare</TabsTrigger>
                <TabsTrigger value="attach">Attach existing</TabsTrigger>
                <TabsTrigger value="manual">Manual link</TabsTrigger>
              </TabsList>
              <TabsContent value="prepare" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Prepare a provider-owned broadcast through an approved league destination.
                  Provisioning does not start the stream and does not show it as live.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="broadcast-destination">Approved destination</Label>
                  <Select value={selectedDestination?.id ?? ""} onValueChange={setDestinationId}>
                    <SelectTrigger id="broadcast-destination"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {destinations.map(destination => (
                        <SelectItem key={destination.id} value={destination.id}>
                          {destination.name} · {destination.provider} {destination.kind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={loading !== null || !selectedDestination}
                  onClick={() => run("preparing", () => prepareBroadcast(matchId, selectedDestination!.id),
                    "Broadcast preparation requested")}
                >
                  {loading === "preparing" ? "Preparing..." : "Prepare broadcast"}
                </Button>
              </TabsContent>
              <TabsContent value="attach" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Attach an existing provider video. The URL is host-validated, then the worker
                  observes the provider; it is never marked live from the URL alone.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="attach-destination">Destination</Label>
                  <Select value={selectedDestination?.id ?? ""} onValueChange={setDestinationId}>
                    <SelectTrigger id="attach-destination"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {destinations.map(destination => (
                        <SelectItem key={destination.id} value={destination.id}>
                          {destination.name} · {destination.provider} {destination.kind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attach-url">Provider video URL or id</Label>
                  <Input
                    id="attach-url"
                    placeholder="https://youtu.be/... or https://www.facebook.com/..."
                    value={attachUrl}
                    onChange={event => setAttachUrl(event.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={loading !== null || !selectedDestination || !attachUrl.trim()}
                  onClick={() => run("attaching", () => attachBroadcast(matchId, {
                    provider: selectedDestination!.provider,
                    destinationId: selectedDestination!.id,
                    url: attachUrl,
                  }), "Attach requested. Waiting for provider observation.")}
                >
                  {loading === "attaching" ? "Attaching..." : "Attach existing"}
                </Button>
              </TabsContent>
              <TabsContent value="manual" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Manual Studio/Live Producer fallback. This records a public link exactly as
                  before and does not create a provider-owned broadcast.
                </p>
                <ManualControls
                  source={source}
                  setSource={setSource}
                  url={url}
                  setUrl={setUrl}
                  loading={loading}
                  onStart={() => run("manual", () => startStream(matchId, source, url), "Stream started")}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No approved provider destination is configured for this league. A platform
                operator must connect the league-owned YouTube channel/playlist or Facebook Page
                first. Manual links remain available.
              </div>
              <ManualControls
                source={source}
                setSource={setSource}
                url={url}
                setUrl={setUrl}
                loading={loading}
                onStart={() => run("manual", () => startStream(matchId, source, url), "Stream started")}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ManualControls({
  source,
  setSource,
  url,
  setUrl,
  loading,
  onStart,
}: {
  source: ManualSource
  setSource: (value: ManualSource) => void
  url: string
  setUrl: (value: string) => void
  loading: string | null
  onStart: () => void
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="stream-source">Source</Label>
        <Select value={source} onValueChange={value => setSource(value as ManualSource)}>
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
          onChange={event => setUrl(event.target.value)}
        />
      </div>
      <Button className="w-full" disabled={loading !== null || !url.trim()} onClick={onStart}>
        <Radio className="h-4 w-4 mr-2" />
        {loading === "manual" ? "Starting..." : "Start manual link"}
      </Button>
    </>
  )
}
