"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Save, Loader2, Users } from "lucide-react"
import { createMatch } from "@/app/actions/matches"

interface NewMatchFormProps {
  teams: { id: string; name: string }[]
  tournaments: { id: string; name: string }[]
}

export function NewMatchForm({ teams, tournaments }: NewMatchFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    teamAId: "", teamBId: "", tournamentId: "", matchFormat: "t20", matchType: "group",
    totalOvers: "20", scheduledDate: "", venueNote: "", umpire1: "", umpire2: "",
  })

  const updateField = (key: string, value: string) => setFormData(prev => ({ ...prev, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (formData.teamAId === formData.teamBId) {
      const msg = "A team cannot play against itself"
      setError(msg)
      toast.error(msg)
      return
    }

    startTransition(async () => {
      try {
        await createMatch({
          teamAId: formData.teamAId,
          teamBId: formData.teamBId,
          tournamentId: formData.tournamentId || null,
          matchFormat: formData.matchFormat as "t20" | "odi" | "test" | "t10" | "custom",
          matchType: formData.matchType as "group" | "knockout" | "final" | "semi_final" | "quarter_final" | "friendly" | "practice",
          totalOvers: Number(formData.totalOvers),
          scheduledDate: formData.scheduledDate || null,
          umpire1: formData.umpire1.trim() || null,
          umpire2: [
            formData.umpire2.trim() || null,
            formData.venueNote.trim() ? `Venue: ${formData.venueNote.trim()}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        })
        toast.success("Match scheduled successfully!")
        router.push("/dashboard/matches")
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to schedule match"
        setError(message)
        toast.error(message)
      }
    })
  }

  // No teams yet — show a helpful empty state instead of a broken dropdown.
  if (teams.length < 2) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <MotionWrapper variant="fadeInLeft">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/matches"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
            <div><h1 className="text-3xl font-bold tracking-tight">Schedule Match</h1><p className="text-muted-foreground mt-1">Create a new cricket fixture.</p></div>
          </div>
        </MotionWrapper>
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card className="py-12 text-center">
            <CardContent>
              <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-semibold text-lg">You need at least 2 teams to schedule a match</p>
              <p className="text-sm text-muted-foreground mt-1">Register teams first, then come back to create fixtures.</p>
              <Link href="/dashboard/teams/new">
                <Button variant="gradient-shine" className="mt-6"><Users className="h-4 w-4 mr-2" />Add a Team</Button>
              </Link>
            </CardContent>
          </Card>
        </MotionWrapper>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/matches"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
          <div><h1 className="text-3xl font-bold tracking-tight">Schedule Match</h1><p className="text-muted-foreground mt-1">Create a new cricket fixture.</p></div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Teams</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Team A *</Label>
                <Select value={formData.teamAId} onValueChange={(v) => updateField("teamAId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>{teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Team B *</Label>
                <Select value={formData.teamBId} onValueChange={(v) => updateField("teamBId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>{teams.filter(t => t.id !== formData.teamAId).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Match Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Tournament</Label>
                <Select value={formData.tournamentId || "none"} onValueChange={(v) => updateField("tournamentId", v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tournament (friendly)</SelectItem>
                    {tournaments.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Format</Label>
                <Select value={formData.matchFormat} onValueChange={(v) => { updateField("matchFormat", v); updateField("totalOvers", v === "t20" ? "20" : v === "odi" ? "50" : v === "t10" ? "10" : "20") }}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="t10">T10 (10 overs)</SelectItem>
                    <SelectItem value="t20">T20 (20 overs)</SelectItem>
                    <SelectItem value="odi">ODI (50 overs)</SelectItem>
                    <SelectItem value="test">Test Match</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Match Type</Label>
                <Select value={formData.matchType} onValueChange={(v) => updateField("matchType", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">Group</SelectItem>
                    <SelectItem value="quarter_final">Quarter Final</SelectItem>
                    <SelectItem value="semi_final">Semi Final</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="overs">Overs per Side</Label>
                <Input id="overs" type="number" value={formData.totalOvers} onChange={(e) => updateField("totalOvers", e.target.value)} min={1} max={450} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="date">Scheduled Date &amp; Time</Label>
                <Input id="date" type="datetime-local" value={formData.scheduledDate} onChange={(e) => updateField("scheduledDate", e.target.value)} className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="venue">Venue note</Label>
                <Input id="venue" value={formData.venueNote} onChange={(e) => updateField("venueNote", e.target.value)} placeholder="Gaddafi Stadium, Lahore" className="mt-1.5" />
                <p className="text-xs text-muted-foreground mt-1">Stored with match notes until venue records are linked.</p>
              </div>
              <div>
                <Label htmlFor="u1">Umpire 1</Label>
                <Input id="u1" value={formData.umpire1} onChange={(e) => updateField("umpire1", e.target.value)} placeholder="Name" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="u2">Umpire 2</Label>
                <Input id="u2" value={formData.umpire2} onChange={(e) => updateField("umpire2", e.target.value)} placeholder="Name" className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <MotionWrapper variant="fadeInUp" delay={0.3}>
          <div className="flex items-center justify-end gap-3">
            <Link href="/dashboard/matches"><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.teamAId || !formData.teamBId}>
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Scheduling...</> : <><Save className="h-4 w-4 mr-2" />Schedule Match</>}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
