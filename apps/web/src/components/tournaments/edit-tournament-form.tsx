"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Save, Loader2, Trophy } from "lucide-react"
import { updateTournament } from "@/app/actions/tournaments"
import { readQualificationRule, type QualificationRule } from "@mtk/database/lib/qualification-policy"
import { useDurableFormDraft } from "@/lib/use-durable-form-draft"
import { DraftRestoreBanner } from "@/components/forms/draft-restore-banner"
import type { Tournament } from "@mtk/database"

interface EditTournamentFormProps {
  tournament: Tournament
}

export function EditTournamentForm({ tournament }: EditTournamentFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // UX-03: per-RECORD draft (keyed by tournament id) over values seeded from
  // server truth; every field here is a PersistableValue string, and the
  // restore is banner-visible - server truth always wins on submit.
  // Batch 146: the organizer's qualification rule, read strictly from the
  // tournament's rules jsonb (null → "none" in the form).
  const existingRule = readQualificationRule(tournament.rules)
  const recordDraft = {
    name: tournament.name ?? "",
    description: tournament.description ?? "",
    format: (tournament.format ?? "league") as string,
    startDate: tournament.startDate ?? "",
    endDate: tournament.endDate ?? "",
    registrationDeadline: tournament.registrationDeadline ?? "",
    maxTeams: tournament.maxTeams?.toString() ?? "8",
    status: (tournament.status ?? "draft") as string,
    // Batch 146: the organizer's qualification rule (their policy, their
    // words). "none" is the default and an explicit choice on submit.
    qualificationKind: existingRule?.kind ?? "none",
    ...(existingRule?.kind === "top_n"
      ? { qualificationSpots: existingRule.spots.toString() }
      : existingRule?.kind === "top_per_group"
        ? { qualificationSpots: existingRule.perGroup.toString() }
        : { qualificationSpots: "2" }),
  }
  const [formData, setFormData] = useState(recordDraft)

  const { draft: restoredDraft, restoredAt, saveDraft, clearDraft, dismissRestored } =
    useDurableFormDraft<Record<string, string>>(`edit-tournament:${tournament.id}`, 1)
  const [draftRestored, setDraftRestored] = useState(false)
  useEffect(() => {
    if (restoredDraft) {
      setFormData(prev => ({ ...prev, ...restoredDraft }) as typeof prev)
      setDraftRestored(true)
    }
  }, [restoredDraft])

  const updateField = (key: string, value: string) => {
    const next = { ...formData, [key]: value }
    setFormData(next)
    saveDraft(next)
  }

  /** Batch 146: null = "none" (an explicit organizer choice, clearing any saved rule). */
  const buildQualificationRule = (): QualificationRule | null => {
    if (formData.qualificationKind === "none") return null
    const size = Number(formData.qualificationSpots)
    if (!Number.isInteger(size) || size < 1 || size > 128) {
      throw new Error("Qualification spots must be a whole number between 1 and 128")
    }
    return formData.qualificationKind === "top_n"
      ? { kind: "top_n", spots: size }
      : { kind: "top_per_group", perGroup: size }
  }

  const handleDiscardDraft = () => {
    clearDraft()
    setFormData(recordDraft)
    setDraftRestored(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        await updateTournament(tournament.id, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          format: formData.format as "knockout" | "league" | "hybrid" | "round_robin",
          startDate: formData.startDate || null,
          endDate: formData.endDate || null,
          registrationDeadline: formData.registrationDeadline || null,
          maxTeams: formData.maxTeams ? Number(formData.maxTeams) : null,
          status: formData.status as "draft" | "registration" | "live" | "completed" | "cancelled",
          // Batch 146: the organizer's standings qualification rule — their
          // policy choice, or an explicit "none". Bounded by the action's
          // strict schema; a malformed value refuses loudly, never silently
          // loses a previously saved rule.
          qualificationRule: buildQualificationRule(),
        })
        toast.success("Tournament updated successfully!")
        clearDraft()
        router.push(`/dashboard/tournaments/${tournament.id}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update tournament"
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/tournaments/${tournament.id}`}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Tournament</h1>
            <p className="text-muted-foreground mt-1">Update {tournament.name}.</p>
          </div>
        </div>
      </MotionWrapper>
      {draftRestored && restoredAt !== null && (
        <DraftRestoreBanner restoredAt={restoredAt} onDiscard={handleDiscardDraft} onDismiss={dismissRestored} />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="h-4 w-4" />Basic Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label htmlFor="name">Tournament Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. SSL Premier League 2026"
                  required
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={formData.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Tournament rules, prizes..."
                  rows={3}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => updateField("status", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="registration">Registration Open</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Format &amp; Rules</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Tournament Format *</Label>
                <Select value={formData.format} onValueChange={(v) => updateField("format", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="league">League (Round Robin)</SelectItem>
                    <SelectItem value="knockout">Knockout</SelectItem>
                    <SelectItem value="hybrid">Group Stage + Knockout</SelectItem>
                    <SelectItem value="round_robin">Double Round Robin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="maxTeams">Max Teams</Label>
                <Input
                  id="maxTeams"
                  type="number"
                  value={formData.maxTeams}
                  onChange={(e) => updateField("maxTeams", e.target.value)}
                  min={2}
                  max={128}
                  className="mt-1.5"
                />
              </div>
              {/* Batch 146: the league organizer's qualification rule. There is
                  NO platform policy — "None" is the default and markers only
                  ever reflect this choice. */}
              <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2 rounded-lg border p-4">
                <div>
                  <Label htmlFor="qualificationKind">Standings Qualification Rule</Label>
                  <Select
                    value={formData.qualificationKind}
                    onValueChange={(v) => updateField("qualificationKind", v)}
                  >
                    <SelectTrigger id="qualificationKind" className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None — no qualification markers</SelectItem>
                      <SelectItem value="top_n">Top N advance</SelectItem>
                      <SelectItem value="top_per_group">Top N per group advance</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Your rule is shown on the public standings exactly as set here.
                  </p>
                </div>
                {formData.qualificationKind !== "none" && (
                  <div>
                    <Label htmlFor="qualificationSpots">
                      {formData.qualificationKind === "top_n" ? "Teams advancing" : "Advancing per group"}
                    </Label>
                    <Input
                      id="qualificationSpots"
                      type="number"
                      value={formData.qualificationSpots}
                      onChange={(e) => updateField("qualificationSpots", e.target.value)}
                      min={1}
                      max={128}
                      className="mt-1.5"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.3}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Schedule</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="start">Start Date</Label>
                <Input id="start" type="date" value={formData.startDate} onChange={(e) => updateField("startDate", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="end">End Date</Label>
                <Input id="end" type="date" value={formData.endDate} onChange={(e) => updateField("endDate", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="regDeadline">Registration Deadline</Label>
                <Input id="regDeadline" type="date" value={formData.registrationDeadline} onChange={(e) => updateField("registrationDeadline", e.target.value)} className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <MotionWrapper variant="fadeInUp" delay={0.4}>
          <div className="flex items-center justify-end gap-3">
            <Link href={`/dashboard/tournaments/${tournament.id}`}><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.name.trim()}>
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
