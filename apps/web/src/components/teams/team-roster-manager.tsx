"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Loader2, UserPlus, UserMinus } from "lucide-react"
import { addPlayerToTeam, removePlayerFromTeam } from "@/app/actions/teams"

interface RosterPlayer {
  id: string
  name: string
  teamId: string | null
}

interface TeamRosterManagerProps {
  teamId: string
  roster: RosterPlayer[]
  availablePlayers: RosterPlayer[]
}

export function TeamRosterManager({
  teamId,
  roster,
  availablePlayers,
}: TeamRosterManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [playerToAdd, setPlayerToAdd] = useState("")

  const unassigned = useMemo(
    () => availablePlayers.filter((p) => !p.teamId || p.teamId !== teamId),
    [availablePlayers, teamId],
  )

  const add = () => {
    if (!playerToAdd) return
    startTransition(async () => {
      try {
        await addPlayerToTeam(teamId, playerToAdd)
        toast.success("Player added to squad")
        setPlayerToAdd("")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add player")
      }
    })
  }

  const remove = (playerId: string) => {
    startTransition(async () => {
      try {
        await removePlayerFromTeam(teamId, playerId)
        toast.success("Player removed from squad")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove player")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Manage Roster</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full">
            <Label>Add player</Label>
            <Select value={playerToAdd} onValueChange={setPlayerToAdd}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={unassigned.length ? "Select player" : "No free players"} />
              </SelectTrigger>
              <SelectContent>
                {unassigned.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.teamId ? " (other team)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={isPending || !playerToAdd} onClick={add}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players on this squad yet.</p>
          ) : (
            roster.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => remove(p.id)}
                >
                  <UserMinus className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
