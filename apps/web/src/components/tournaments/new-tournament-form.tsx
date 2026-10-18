"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Save, Loader2, Trophy } from "lucide-react"
import { createTournament } from "@/app/actions/tournaments"
import { useDurableFormDraft } from "@/lib/use-durable-form-draft"
import { DraftRestoreBanner } from "@/components/forms/draft-restore-banner"

interface NewTournamentFormProps {
  /**
   * Kept for backward compatibility with callers that still pass tenantId,
   * but no longer used — the server action resolves the tenant from Clerk
   * auth via the tenant context. Safe to remove from call sites.
   */
  tenantId?: string
}

export function NewTournamentForm(_props: NewTournamentFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // COMP-03 (Batch 136): one idempotency key per intended creation. A
  // retried submit (network failure, timeout) reuses it, so the server
  // replays the first tournament instead of duplicating it. The key rides
  // inside the durable draft, so even refresh-close-reopen keeps the same
  // intent; a restored draft's key wins over the freshly minted one.
  const [requestKey, setRequestKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `tk-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    format: "league",
    startDate: "",
    endDate: "",
    registrationDeadline: "",
    maxTeams: "8",
  })

  // UX-03: the competition setup survives an accidental refresh/close as a
  // per-browser draft - banner-visible, version-checked, week-limited.
  const { draft: restoredDraft, restoredAt, saveDraft, clearDraft, dismissRestored } =
    useDurableFormDraft<Record<string, string>>("new-tournament", 1)
  const [draftRestored, setDraftRestored] = useState(false)
  useEffect(() => {
    if (restoredDraft) {
      setFormData(prev => ({ ...prev, ...restoredDraft }) as typeof prev)
      if (typeof restoredDraft.requestKey === "string" && restoredDraft.requestKey) setRequestKey(restoredDraft.requestKey)
      setDraftRestored(true)
    }
  }, [restoredDraft])

  const updateField = (key: string, value: string) => {
    const next = { ...formData, [key]: value }
    setFormData(next)
    saveDraft({ ...next, requestKey })
  }

  const handleDiscardDraft = () => {
    clearDraft()
    setFormData({ name: "", description: "", format: "league", startDate: "", endDate: "", registrationDeadline: "", maxTeams: "8" })
    setDraftRestored(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        await createTournament({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          format: formData.format as "knockout" | "league" | "hybrid" | "round_robin",
          startDate: formData.startDate || null,
          endDate: formData.endDate || null,
          registrationDeadline: formData.registrationDeadline || null,
          maxTeams: formData.maxTeams ? Number(formData.maxTeams) : null,
          requestKey,
        })
        clearDraft()
        router.push("/dashboard/tournaments")
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create tournament"
        setError(message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/tournaments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Create Tournament</h1>
            <p className="text-muted-foreground mt-1">Set up a new league or knockout competition.</p>
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
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Format & Rules</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Tournament Format *</Label>
                <Select value={formData.format} onValueChange={(v) => updateField("format", v)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
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
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.3}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="start">Start Date</Label>
                <Input
                  id="start"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="end">End Date</Label>
                <Input
                  id="end"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => updateField("endDate", e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="regDeadline">Registration Deadline</Label>
                <Input
                  id="regDeadline"
                  type="date"
                  value={formData.registrationDeadline}
                  onChange={(e) => updateField("registrationDeadline", e.target.value)}
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

        <MotionWrapper variant="fadeInUp" delay={0.4}>
          <div className="flex items-center justify-end gap-3">
            <Link href="/dashboard/tournaments">
              <Button variant="outline" type="button">Cancel</Button>
            </Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.name}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />Create Tournament
                </>
              )}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
