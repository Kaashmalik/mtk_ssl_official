"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import {
  saveLeagueApplication,
  submitLeagueApplication,
  withdrawLeagueApplication,
  type LeagueApplicationView,
} from "@/app/actions/league-applications"
import { ClipboardCheck, FileText, ShieldCheck } from "lucide-react"

const PLAN_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const

type PlanChoice = (typeof PLAN_OPTIONS)[number]["value"]

const STATE_LABELS: Record<LeagueApplicationView["state"], string> = {
  draft: "Draft",
  submitted: "Under review",
  needs_information: "Information requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
}

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function isEditable(state: LeagueApplicationView["state"]) {
  return state === "draft" || state === "needs_information"
}

export function LeagueApplicationForm({ initialApplication }: { initialApplication: LeagueApplicationView | null }) {
  const [isPending, startTransition] = useTransition()
  const [application, setApplication] = useState<LeagueApplicationView | null>(initialApplication)
  const [showForm, setShowForm] = useState(initialApplication === null)
  const [name, setName] = useState(
    initialApplication && isEditable(initialApplication.state) ? initialApplication.proposedName : "",
  )
  const [slug, setSlug] = useState(
    initialApplication && isEditable(initialApplication.state) ? initialApplication.proposedSlug : "",
  )
  const [plan, setPlan] = useState<PlanChoice>(
    initialApplication && isEditable(initialApplication.state) ? initialApplication.desiredPlan : "free",
  )
  const [error, setError] = useState<string | null>(null)

  const derivedSlug = useMemo(() => (name ? toSlug(name) : ""), [name])

  const state = application?.state ?? null
  const formVisible = showForm || state === "draft" || state === "needs_information"
  const summaryVisible = !formVisible && (state === "submitted" || state === "rejected" || state === "withdrawn")
  const reasonVisible = (state === "needs_information" || state === "rejected") && Boolean(application?.reviewReason)
  const resubmission = state === "needs_information"

  const run = (operation: () => Promise<LeagueApplicationView>) =>
    startTransition(async () => {
      setError(null)
      try {
        setApplication(await operation())
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update the application")
      }
    })

  const plannedSave = () =>
    saveLeagueApplication({
      name: name.trim(),
      slug: (slug || derivedSlug).trim(),
      desiredPlan: plan,
      expectedVersion: application ? application.version : null,
    })

  const handleSaveDraft = () => run(async () => (await plannedSave()).application)

  const handleSubmitForReview = () =>
    startTransition(async () => {
      setError(null)
      try {
        // Persist the latest fields first, then submit exactly the version the
        // save produced: the server refuses stale input, so the pair is safe
        // even if another tab touched the application in between.
        const saved = await plannedSave()
        setApplication(saved.application)
        const submitted = await submitLeagueApplication({ expectedVersion: saved.application.version })
        setApplication(submitted.application)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit the application")
      }
    })

  const handleWithdraw = () => {
    if (!application) return
    run(async () => (await withdrawLeagueApplication({ expectedVersion: application.version })).application)
  }

  const handleStartNew = () => {
    setShowForm(true)
    setName("")
    setSlug("")
    setPlan("free")
    setError(null)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {application && (summaryVisible || state === "approved") && (
        <Card className="border-border/50">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <CardTitle className="text-lg">{application.proposedName}</CardTitle>
              </div>
              <Badge variant="outline">{STATE_LABELS[application.state]}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              League URL: <Badge variant="outline">{application.proposedSlug}</Badge>{" "}
              · Preferred plan: <span className="capitalize">{application.desiredPlan}</span>
            </p>
            {reasonVisible && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                <span className="font-medium">Platform note:</span> {application.reviewReason}
              </div>
            )}
            {state === "submitted" && (
              <p>The platform team is reviewing this application. You can withdraw it if the details need to change.</p>
            )}
            {state === "approved" && <p>This application was approved and your league workspace is active.</p>}
          </CardContent>
        </Card>
      )}

      {formVisible && (
        <Card className="border-border/50">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              <CardTitle className="text-lg">{resubmission ? "Answer the review request" : "Application details"}</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              The platform team reviews every application before a workspace is activated. Approval creates a
              Free-tier league; a preferred paid plan is recorded for the onboarding conversation and keeps flowing
              through the existing subscription request flow.
            </p>
          </CardHeader>
          <CardContent className="grid gap-5">
            {resubmission && application?.reviewReason && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <span className="font-medium">Platform note:</span> {application.reviewReason}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="application-name">League name</Label>
              <Input
                id="application-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shakir Super League"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="application-slug">League URL</Label>
              <Input
                id="application-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={derivedSlug || "your-league"}
                required
              />
              <p className="text-xs text-muted-foreground">
                Proposed public URL: <Badge variant="outline">{(slug || derivedSlug || "your-league")}.ssl.mtkcodex.site</Badge>
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="application-plan">Preferred plan</Label>
              <Select value={plan} onValueChange={(value) => setPlan(value as PlanChoice)}>
                <SelectTrigger id="application-plan">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4 mt-0.5" />
              Drafts are private to you. A submitted application is read only; withdraw it to start over with new
              details.
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {application && (isEditable(application.state) || application.state === "submitted") && (
                <Button type="button" variant="outline" onClick={handleWithdraw} disabled={isPending}>
                  Withdraw
                </Button>
              )}
              <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isPending || !name}>
                {isPending ? "Working..." : "Save draft"}
              </Button>
              <Button
                type="button"
                variant="gradient-shine"
                onClick={handleSubmitForReview}
                disabled={isPending || !name}
              >
                {isPending ? "Submitting..." : resubmission ? "Resubmit for review" : "Submit for review"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {summaryVisible && state === "submitted" && (
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleWithdraw} disabled={isPending}>
            {isPending ? "Working..." : "Withdraw application"}
          </Button>
        </div>
      )}

      {summaryVisible && (state === "rejected" || state === "withdrawn") && (
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="secondary" onClick={handleStartNew} disabled={isPending}>
            Start a new application
          </Button>
        </div>
      )}

      {state === "approved" && (
        <div className="flex items-center justify-end gap-3">
          <Button asChild variant="outline">
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
