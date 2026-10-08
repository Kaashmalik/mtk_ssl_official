"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Label } from "@mtk/ui/components/ui/label"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Loader2, Save, Users } from "lucide-react"
import { registerTeam } from "@/app/actions/registrations"

interface TeamOption {
  id: string
  name: string
}

interface TournamentOption {
  id: string
  name: string
  registrationOpen: boolean
}

interface PlayerOption {
  id: string
  name: string
  teamId: string | null
}

interface RegisterTeamFormProps {
  teams: TeamOption[]
  tournaments: TournamentOption[]
  players: PlayerOption[]
  defaultTournamentId?: string
}

export function RegisterTeamForm({
  teams,
  tournaments,
  players,
  defaultTournamentId,
}: RegisterTeamFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTournament =
    defaultTournamentId ||
    searchParams.get("tournamentId") ||
    tournaments.find((t) => t.registrationOpen)?.id ||
    ""

  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tournamentId, setTournamentId] = useState(initialTournament)
  const [teamId, setTeamId] = useState("")
  const [notes, setNotes] = useState("")
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])

  const openTournaments = tournaments.filter((t) => t.registrationOpen)
  const squadCandidates = useMemo(
    () => players.filter((p) => !teamId || p.teamId === teamId || p.teamId === null),
    [players, teamId],
  )

  const togglePlayer = (playerId: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : prev.length >= 30
          ? prev
          : [...prev, playerId],
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!tournamentId || !teamId) {
      setError("Select a tournament and team")
      return
    }
    if (selectedPlayers.length < 1) {
      setError("Select at least one squad player")
      return
    }

    startTransition(async () => {
      try {
        await registerTeam({
          tournamentId,
          teamId,
          squadPlayerIds: selectedPlayers,
          registrationFee: "0",
          notes: notes.trim() || null,
        })
        toast.success("Registration submitted")
        router.push("/dashboard/registrations")
        router.refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : "Registration failed"
        setError(message)
        toast.error(message)
      }
    })
  }

  if (teams.length === 0 || openTournaments.length === 0) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <MotionWrapper variant="fadeInLeft">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/registrations">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Register Team</h1>
              <p className="text-muted-foreground mt-1">
                Submit a squad for a tournament with open registration.
              </p>
            </div>
          </div>
        </MotionWrapper>
        <Card className="py-12 text-center">
          <CardContent>
            <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-semibold text-lg">
              {teams.length === 0
                ? "Create a team before registering"
                : "No tournaments are open for registration"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {teams.length === 0
                ? "Add a team, then return here to register for a tournament."
                : "Open registration from a tournament detail page first."}
            </p>
            <Link href={teams.length === 0 ? "/dashboard/teams/new" : "/dashboard/tournaments"}>
              <Button variant="gradient-shine" className="mt-6">
                {teams.length === 0 ? "Add a Team" : "View Tournaments"}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/registrations">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Register Team</h1>
            <p className="text-muted-foreground mt-1">
              Pick tournament, team, and squad players.
            </p>
          </div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Registration Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Tournament *</Label>
              <Select value={tournamentId} onValueChange={setTournamentId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select tournament" />
                </SelectTrigger>
                <SelectContent>
                  {openTournaments.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Team *</Label>
              <Select
                value={teamId}
                onValueChange={(v) => {
                  setTeamId(v)
                  setSelectedPlayers([])
                }}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for league admins"
                rows={3}
                className="mt-1.5"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Squad ({selectedPlayers.length} selected)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {!teamId ? (
              <p className="text-sm text-muted-foreground">Select a team to choose squad players.</p>
            ) : squadCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No players available. Add players and assign them to this team first.
              </p>
            ) : (
              squadCandidates.map((p) => {
                const checked = selectedPlayers.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer(p.id)}
                    className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                      checked ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${
                        checked ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/40"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="text-sm font-medium">{p.name}</span>
                    {!p.teamId && (
                      <span className="text-xs text-muted-foreground ml-auto">Unassigned</span>
                    )}
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/registrations">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            variant="gradient-shine"
            disabled={isPending || !tournamentId || !teamId || selectedPlayers.length < 1}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Submit Registration
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
