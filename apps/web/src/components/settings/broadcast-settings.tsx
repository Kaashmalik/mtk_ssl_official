"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Radio } from "lucide-react"
import type { BroadcastDestinationOption } from "@mtk/contracts"
import { setDefaultBroadcastDestination } from "@/app/actions/broadcast"
import { toast } from "sonner"

export function BroadcastSettings({ destinations }: { destinations: BroadcastDestinationOption[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)

  async function choose(destinationId: string) {
    setPending(destinationId)
    try {
      await setDefaultBroadcastDestination(destinationId)
      toast.success("Default broadcast destination saved")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save default destination")
    } finally {
      setPending(null)
    }
  }

  if (destinations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" /> Provider destinations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>No approved broadcast destination is connected to this league yet.</p>
          <p>
            A platform operator must connect a league-owned YouTube channel/playlist or an
            authorized Facebook Page. League owners never enter provider tokens here.
          </p>
          <p>Manual Studio/Live Producer links remain available from each match.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" /> Provider destinations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Choose the destination offered first when an operator prepares a match broadcast.
          A playlist organizes videos; it is not a privacy boundary.
        </p>
        <ul className="space-y-2">
          {destinations.map(destination => (
            <li key={destination.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{destination.name}</span>
                  {destination.isDefault && <Badge>Default</Badge>}
                  {destination.connectionStatus !== "active" && (
                    <Badge variant="destructive">{destination.connectionStatus}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {destination.provider} {destination.kind} · {destination.connectionDisplayName}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={destination.isDefault ? "secondary" : "outline"}
                disabled={pending !== null || destination.isDefault || destination.connectionStatus !== "active"}
                onClick={() => choose(destination.id)}
              >
                {destination.isDefault ? "Current default" : pending === destination.id ? "Saving..." : "Make default"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
