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
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import { updateMatch } from "@/app/actions/matches"

interface EditMatchFormProps {
  match: {
    id: string
    teamAId: string
    teamBId: string
    matchFormat: string
    matchType: string
    totalOvers: number
    scheduledDate: Date | null
    umpire1: string | null
    umpire2: string | null
  }
  teams: { id: string; name: string }[]
}

// Convert Date object to datetime-local input string format (YYYY-MM-DDTHH:mm)
function formatForDateTimeLocal(date: Date | null): string {
  if (!date) return ""
  const d = new Date(date)
  const pad = (num: number) => String(num).padStart(2, "0")
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function EditMatchForm({ match, teams }: EditMatchFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    matchFormat: match.matchFormat,
    matchType: match.matchType,
    totalOvers: String(match.totalOvers),
    scheduledDate: formatForDateTimeLocal(match.scheduledDate),
    umpire1: match.umpire1 || "",
    umpire2: match.umpire2 || "",
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
        await updateMatch(match.id, {
          teamAId: formData.teamAId,
          teamBId: formData.teamBId,
          matchFormat: formData.matchFormat as "t20" | "odi" | "test" | "t10" | "custom",
          matchType: formData.matchType as "group" | "knockout" | "final" | "semi_final" | "quarter_final" | "friendly" | "practice",
          totalOvers: Number(formData.totalOvers),
          scheduledDate: formData.scheduledDate || null,
          umpire1: formData.umpire1.trim() || null,
          umpire2: formData.umpire2.trim() || null,
        })
        toast.success("Match updated successfully!")
        router.push(`/dashboard/matches/${match.id}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update match"
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/matches/${match.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Match</h1>
            <p className="text-muted-foreground mt-1">Modify match schedule and configurations.</p>
          </div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Teams</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Team A *</Label>
                <Select value={formData.teamAId} onValueChange={(v) => updateField("teamAId", v)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Team B *</Label>
                <Select value={formData.teamBId} onValueChange={(v) => updateField("teamBId", v)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.filter(t => t.id !== formData.teamAId).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Match Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Format</Label>
                <Select
                  value={formData.matchFormat}
                  onValueChange={(v) => {
                    updateField("matchFormat", v)
                    updateField("totalOvers", v === "t20" ? "20" : v === "odi" ? "50" : v === "t10" ? "10" : "20")
                  }}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
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
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
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
                <Input
                  id="overs"
                  type="number"
                  value={formData.totalOvers}
                  onChange={(e) => updateField("totalOvers", e.target.value)}
                  min={1}
                  max={450}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="date">Scheduled Date &amp; Time</Label>
                <Input
                  id="date"
                  type="datetime-local"
                  value={formData.scheduledDate}
                  onChange={(e) => updateField("scheduledDate", e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="u1">Umpire 1</Label>
                <Input
                  id="u1"
                  value={formData.umpire1}
                  onChange={(e) => updateField("umpire1", e.target.value)}
                  placeholder="Name"
                  className="mt-1.5"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="u2">Umpire 2</Label>
                <Input
                  id="u2"
                  value={formData.umpire2}
                  onChange={(e) => updateField("umpire2", e.target.value)}
                  placeholder="Name"
                  className="mt-1.5"
                />
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
            <Link href={`/dashboard/matches/${match.id}`}>
              <Button variant="outline" type="button">Cancel</Button>
            </Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" />Save Changes</>
              )}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
