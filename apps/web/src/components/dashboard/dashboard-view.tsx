import React from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Circle, Trophy, Users, CalendarDays, Sword } from "lucide-react"
import { formatDashboardDate, getDashboardActions, getSetupSteps, matchDashboardHref,
  type DashboardStats, type DashboardMatch } from "@/lib/dashboard-model"
import { ROLE_LABELS } from "@/lib/rbac"
import type { DashboardContext } from "@/lib/dashboard-context"

const linkStyle = "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
export function DashboardPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section aria-label={title} className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
    <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>
    {children}
  </section>
}

export function DashboardUnavailable({ title }: { title: string }) {
  return <DashboardPanel title={title}>
    <div role="status" className="rounded-xl border border-dashed p-4 text-sm">
      <p className="font-medium">This information is temporarily unavailable.</p>
      <p className="mt-1 text-muted-foreground">Nothing has been changed. Refresh the dashboard to try again.</p>
      <a href="/dashboard" className={`${linkStyle} mt-3 inline-flex min-h-11 items-center font-medium text-primary`}>Refresh dashboard</a>
    </div>
  </DashboardPanel>
}

export function DashboardLoading({ title }: { title: string }) {
  return <DashboardPanel title={title}>
    <div role="status" aria-label={`Loading ${title.toLowerCase()}`} className="space-y-3">
      <span className="sr-only">Loading {title.toLowerCase()}…</span>
      {[0, 1, 2].map((i) => <div key={i} aria-hidden="true" className="h-12 rounded-xl bg-muted motion-safe:animate-pulse" />)}
    </div>
  </DashboardPanel>
}

export function DashboardHeader({ context }: { context: DashboardContext }) {
  const primary = getDashboardActions(context.role)[0]
  return <header className="flex flex-col gap-4 rounded-2xl border bg-linear-to-br from-primary/10 via-card to-card p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">League workspace · {ROLE_LABELS[context.role]}</p>
      <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{context.tenantName}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{context.role === "scorer"
        ? "Pick up an assigned match and keep every delivery in sync."
        : "Your fixtures, teams, and next steps in one place."}</p>
    </div>
    {primary && <Link href={primary.href} className={`${linkStyle} inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground`}>
      {primary.label}<ArrowRight aria-hidden="true" className="h-4 w-4" />
    </Link>}
  </header>
}

export function DashboardMetrics({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Active teams", value: stats.teams, Icon: Users },
    { label: "Active players", value: stats.players, Icon: Sword },
    { label: "Tournaments", value: stats.tournaments, Icon: Trophy },
    { label: "Total matches", value: stats.matches, Icon: CalendarDays },
  ]
  return <section aria-label="League overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {cards.map(({ label, value, Icon }) => <div key={label} className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <Icon aria-hidden="true" className="mb-3 h-5 w-5 text-primary" />
      <p className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{value.toLocaleString("en-GB")}</p>
    </div>)}
  </section>
}

export function DashboardSetup({ stats }: { stats: DashboardStats }) {
  const steps = getSetupSteps(stats)
  const done = steps.filter((step) => step.done).length
  return <DashboardPanel title="League setup">
    <p className="mb-4 text-sm text-muted-foreground">{done === steps.length ? "Your first steps are complete. Keep growing your league." : `${done} of ${steps.length} first steps complete`}</p>
    <ol className="grid gap-2 sm:grid-cols-2">
      {steps.map((step) => <li key={step.label} className="flex min-w-0 items-center gap-3 rounded-xl border p-3">
        {step.done ? <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" /> : <Circle aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 text-sm">
          <span className="block text-xs text-muted-foreground">{step.done ? "Complete" : "Next step"}</span>
          {step.done ? <span className="font-medium">{step.label}</span> : <Link href={step.href} className={`${linkStyle} inline-flex min-h-11 items-center font-medium hover:text-primary`}>{step.label}</Link>}
        </div>
      </li>)}
    </ol>
    <p className="mt-4 text-xs text-muted-foreground">This checklist tracks league records, not match readiness or playing-XI approval.</p>
  </DashboardPanel>
}

export function DashboardQuickActions({ context }: { context: DashboardContext }) {
  return <DashboardPanel title="Quick actions">
    <ul className="space-y-2">
      {getDashboardActions(context.role).map((action) => <li key={action.href}>
        <Link href={action.href} className={`${linkStyle} flex min-h-11 items-center justify-between gap-3 border p-3 transition-colors hover:bg-muted/50`}>
          <span className="min-w-0"><span className="block text-sm font-semibold">{action.label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{action.description}</span></span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </li>)}
    </ul>
  </DashboardPanel>
}

const statusLabels: Record<string, string> = { scheduled: "Scheduled", toss: "Toss", live: "Live", innings_break: "Innings break", completed: "Completed" }
export function DashboardMatchList({ title, matches, context, empty }: {
  title: string; matches: DashboardMatch[]; context: DashboardContext; empty: string
}) {
  return <DashboardPanel title={title}>
    <p className="mb-3 text-xs text-muted-foreground">Up to 5 matches · Times in UTC · Scores as of this page load</p>
    {!matches.length ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{empty}</p> :
      <ul className="space-y-3">{matches.map((match) => {
        const href = matchDashboardHref(match, context.role, context.actorId)
        const canScore = href.endsWith("/scoring")
        return <li key={match.id}>
          <Link href={href} className={`${linkStyle} block border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium">{statusLabels[match.status] ?? match.status}</span>
              <span className="text-muted-foreground">{match.status === "completed"
                ? `Updated ${formatDashboardDate(match.updatedAt)}`
                : `Scheduled: ${formatDashboardDate(match.scheduledDate)}`}</span>
            </div>
            {[{ name: match.teamA, score: match.scoreA }, { name: match.teamB, score: match.scoreB }].map((team, index) =>
              <div key={index} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1 text-sm">
                <span className="min-w-0 break-words font-semibold">{team.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{team.score}</span>
              </div>)}
            {match.result && <p className="mt-2 break-words text-xs text-muted-foreground">{match.result}</p>}
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">{canScore ? "Open scoring" : "View match"}<ArrowRight aria-hidden="true" className="h-3 w-3" /></span>
          </Link>
        </li>
      })}</ul>}
  </DashboardPanel>
}

export function DashboardAttention({ attention }: { attention: { unassigned: number; pending: number } }) {
  return <DashboardPanel title="Needs attention">
    {attention.unassigned === 0 && attention.pending === 0 && <p className="mb-3 text-sm text-muted-foreground">No scorer-assignment or registration tasks right now.</p>}
    <ul className="space-y-2">
      {[{ count: attention.unassigned, label: "Matches without a scorer", href: "/dashboard/matches" },
        { count: attention.pending, label: "Pending registrations", href: "/dashboard/registrations" }].map((item) =>
        <li key={item.href}><Link href={item.href} className={`${linkStyle} flex min-h-11 items-center justify-between gap-3 border p-3 text-sm hover:bg-muted/50`}>
          <span>{item.label}</span><span className="font-semibold tabular-nums">{item.count}</span>
        </Link></li>)}
    </ul>
  </DashboardPanel>
}
