"use client"

import * as React from "react"

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  Compass,
  MonitorPlay,
  Radio,
  ShieldCheck,
  Trophy,
  Users,
  WifiOff,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { ThemeToggle } from "@mtk/ui/components/theme-toggle"
import { useClerkReady } from "@/components/providers"
import type { HomePulse } from "@/lib/home-pulse"

/*
 * Landing page rules (honesty pins in __tests__/home-*.test.tsx):
 * - every number on this page is either real published data (`pulse`) or
 *   sits inside an illustration explicitly labelled as sample data;
 * - "Live" only appears when the hub read reports live fixtures;
 * - no React hooks besides useClerkReady: the tests execute these
 *   components as plain functions.
 */

const FEATURES = [
  {
    title: "Ball-by-ball live scoring",
    description: "Large, one-hand controls with undo, wicket details and extras. Every ball reaches fans as it is scored.",
    Icon: Zap,
  },
  {
    title: "Keeps scoring offline",
    description: "Balls recorded without signal wait in a visible queue and sync in order when the connection returns.",
    Icon: WifiOff,
  },
  {
    title: "Fixtures and standings",
    description: "Generate fixtures, group stages and knockouts. Points tables and net run rate update from real results.",
    Icon: CalendarRange,
  },
  {
    title: "Registrations and squads",
    description: "Teams apply, pay or get waived, and submit squads. Organizers see exactly which eligibility rule is still open.",
    Icon: ClipboardCheck,
  },
  {
    title: "Player careers and leaderboards",
    description: "Batting, bowling, fielding and keeping records built from every scored ball, across every season.",
    Icon: BarChart3,
  },
  {
    title: "Broadcast scoreboards",
    description: "Live score overlays for OBS, driven by the same scoring data your fans see in the match centre.",
    Icon: MonitorPlay,
  },
] as const

const ROLES = [
  {
    role: "Organizers",
    Icon: Trophy,
    points: ["Set up competitions, venues and fixtures", "Review team registrations and squads", "Assign scorers for each match"],
  },
  {
    role: "Scorers",
    Icon: Activity,
    points: ["Readable in bright sunlight", "Undo and correct without losing the innings", "See exactly what is saved and what is waiting"],
  },
  {
    role: "Players and fans",
    Icon: Users,
    points: ["Follow live matches and scorecards", "Check standings and leaderboards", "Share results with one link"],
  },
] as const

const STEPS = [
  { title: "Apply for your league", description: "Tell us about your league. Once approved, your workspace is ready." },
  { title: "Add teams and fixtures", description: "Invite teams, open registrations and generate the schedule." },
  { title: "Score live and share", description: "Scorers record every ball; players and fans follow along in real time." },
] as const

function AuthCta({ clerkReady, variant = "default" }: { clerkReady: boolean; variant?: "default" | "secondary" }) {
  const ctaButton = (label: string) => (
    <Button
      size="xl"
      variant={variant}
      className={`group rounded-xl px-7 font-semibold ${variant === "default" ? "shadow-lg shadow-primary/25" : ""}`}
    >
      {label}
      <ArrowRight className="ml-1 transition-transform group-hover:translate-x-1" />
    </Button>
  )
  if (!clerkReady) return <Link href="/sign-in">{ctaButton("Start Your League")}</Link>
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">{ctaButton("Start Your League")}</SignInButton>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard">{ctaButton("Manage Dashboard")}</Link>
      </SignedIn>
    </>
  )
}

function NavAuth({ clerkReady }: { clerkReady: boolean }) {
  if (!clerkReady) {
    return (
      <Link href="/sign-in">
        <Button variant="ghost">Sign In</Button>
      </Link>
    )
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <Button variant="ghost">Sign In</Button>
        </SignInButton>
        <SignInButton mode="modal">
          <Button className="rounded-full px-5 font-semibold">Get Started</Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard">
          <Button className="rounded-full px-5 font-semibold">Dashboard</Button>
        </Link>
        <UserButton />
      </SignedIn>
    </>
  )
}

/** Illustration of the scorer view. Every value in it is sample data and labelled as such. */
function ScorerPreview() {
  const thisOver = ["1", "4", "•", "W", "6", "2"]
  const pad = ["0", "1", "2", "3", "4", "6"]
  return (
    <figure
      role="img"
      aria-label="Illustration of the scorer view, using sample data"
      className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Scorer view</span>
        <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          Sample data
        </span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Falcons batting · 2nd innings</p>
            <p className="font-display mt-1 text-5xl font-extrabold tabular-nums tracking-tight">
              142<span className="text-muted-foreground">/4</span>
            </p>
          </div>
          <div className="text-right text-sm tabular-nums">
            <p className="font-semibold">16.3 overs</p>
            <p className="text-muted-foreground">Need 23 from 21</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Striker</p>
            <p className="mt-0.5 font-semibold">A. Rahman <span className="tabular-nums text-muted-foreground">48 (31)</span></p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Bowler</p>
            <p className="mt-0.5 font-semibold">S. Iqbal <span className="tabular-nums text-muted-foreground">3.3–0–29–2</span></p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">This over</p>
          <div className="mt-2 flex gap-2">
            {thisOver.map((ball, i) => (
              <span
                key={i}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
                  ball === "W"
                    ? "bg-wicket-red text-white"
                    : ball === "4" || ball === "6"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background"
                }`}
              >
                {ball}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-6 gap-2">
          {pad.map((run) => (
            <span
              key={run}
              className="flex h-12 items-center justify-center rounded-xl border border-border bg-background text-lg font-bold tabular-nums"
            >
              {run}
            </span>
          ))}
          {["Wd", "Nb", "B", "LB"].map((extra) => (
            <span key={extra} className="col-span-1 flex h-10 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
              {extra}
            </span>
          ))}
          <span className="col-span-2 flex h-10 items-center justify-center rounded-lg bg-wicket-red text-sm font-bold text-white">
            Wicket
          </span>
        </div>
      </div>
    </figure>
  )
}

/** Real published activity from the public hub. Renders nothing when there is no trustworthy read. */
function HubPulse({ pulse }: { pulse: HomePulse | null }) {
  if (!pulse) return null
  if (pulse.leagues === 0) {
    return (
      <section aria-labelledby="pulse-heading" className="mt-20 rounded-2xl border border-dashed border-border p-6 text-center">
        <h2 id="pulse-heading" className="font-display text-xl font-bold">The public hub is open</h2>
        <p className="mt-2 text-sm text-muted-foreground">No league has listed itself publicly yet. Yours could be the first.</p>
      </section>
    )
  }
  const stats = [
    { label: pulse.leagues === 1 ? "Public league" : "Public leagues", value: `${pulse.leagues}${pulse.complete ? "" : "+"}` },
    { label: pulse.competitions === 1 ? "Published competition" : "Published competitions", value: String(pulse.competitions) },
    { label: pulse.liveMatches === 1 ? "Match live now" : "Matches live now", value: String(pulse.liveMatches) },
  ]
  return (
    <section aria-labelledby="pulse-heading" className="mt-20 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 id="pulse-heading" className="flex items-center gap-2 text-sm font-semibold">
          {pulse.liveMatches > 0 ? (
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
            </span>
          ) : (
            <Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          On the public hub right now
        </h2>
        <Link href="/hub" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Explore the hub
        </Link>
      </div>
      <dl className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {stats.map((stat) => (
          <div key={stat.label} className="px-6 py-5">
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="font-display mt-1 text-3xl font-extrabold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {pulse.featured.length > 0 && (
        <ul className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {pulse.featured.map((league) => {
            const body = (
              <>
                <span className="truncate font-semibold">{league.name}</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {league.liveMatches > 0
                    ? `${league.liveMatches} live`
                    : `${league.publishedCompetitions} ${league.publishedCompetitions === 1 ? "competition" : "competitions"}`}
                </span>
              </>
            )
            return (
              <li key={league.tenantId} className="bg-card">
                {league.url ? (
                  <a href={league.url} className="flex flex-col px-6 py-4 transition-colors hover:bg-muted/50">{body}</a>
                ) : (
                  <div className="flex flex-col px-6 py-4">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function HomeContent({ brandName, pulse = null }: { brandName: string; pulse?: HomePulse | null }) {
  const clerkReady = useClerkReady()
  const year = new Date().getFullYear()

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Pitch-line texture: quiet structure instead of glow blobs. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      />

      <header className="container relative z-10 mx-auto flex items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">{brandName}</span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how-it-works" className="hover:text-foreground">How it works</a>
          <Link href="/leaderboards" className="hover:text-foreground">Leaderboards</Link>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <NavAuth clerkReady={clerkReady} />
        </div>
      </header>

      <main className="container relative z-10 mx-auto px-6 pb-12 pt-10 lg:pt-16">
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <MotionWrapper variant="fadeInLeft" className="space-y-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Cricket league operations
            </p>

            <h1 className="font-display max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[1.02] tracking-tight text-balance">
              Run every match day with <span className="text-primary">clarity and confidence.</span>
            </h1>

            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
              {brandName} brings tournaments, teams, live scoring, and player performance into one dependable workspace built for organizers and scorers.
            </p>

            <div className="flex flex-wrap gap-3">
              <AuthCta clerkReady={clerkReady} />
              <Button size="xl" variant="outline" className="group rounded-xl font-semibold" asChild>
                <Link href="/hub">
                  <Compass className="mr-1 transition-colors group-hover:text-primary" />
                  Explore the platform
                </Link>
              </Button>
            </div>

            <ul className="flex flex-wrap items-center gap-x-7 gap-y-3 pt-2 text-sm font-medium text-muted-foreground">
              <li className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>Tournaments &amp; Leagues</span>
              </li>
              <li className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>Live Scoring</span>
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>Pro Analytics</span>
              </li>
            </ul>
          </MotionWrapper>

          <MotionWrapper variant="fadeInRight" delay={0.15}>
            <ScorerPreview />
          </MotionWrapper>
        </div>

        <HubPulse pulse={pulse} />

        <section id="features" aria-labelledby="features-heading" className="mt-28 scroll-mt-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Everything for match day</p>
            <h2 id="features-heading" className="font-display mt-3 text-[clamp(1.875rem,4vw,3rem)] font-extrabold leading-tight tracking-tight">
              From first fixture to final score
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              One system for the people who run the league, the people who score it, and the people who follow it.
            </p>
          </div>
          <ul className="motion-stagger mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, description, Icon }) => (
              <li key={title} className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
                <span aria-hidden="true" className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="roles-heading" className="mt-28">
          <h2 id="roles-heading" className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-extrabold tracking-tight">
            Built for every role on match day
          </h2>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {ROLES.map(({ role, Icon, points }) => (
              <div key={role} className="rounded-2xl border border-border bg-muted/40 p-6">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">{role}</h3>
                </div>
                <ul className="mt-5 space-y-3 text-sm">
                  {points.map((point) => (
                    <li key={point} className="flex gap-2.5">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="text-foreground/85">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className="mt-28 scroll-mt-24">
          <h2 id="how-heading" className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-extrabold tracking-tight">
            How it works
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-2xl border border-border bg-card p-6">
                <span className="font-display text-4xl font-extrabold text-primary/70 tabular-nums" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="cta-heading"
          className="relative mt-28 overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12"
        >
          <Trophy className="absolute -right-6 -top-6 h-40 w-40 opacity-10" aria-hidden="true" />
          <h2 id="cta-heading" className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold tracking-tight">
            Ready for your next season?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">
            Set up your league, invite your teams, and let the platform keep match day moving.
          </p>
          <div className="mt-8 flex justify-center">
            <AuthCta clerkReady={clerkReady} variant="secondary" />
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border">
        <div className="container mx-auto flex flex-col gap-6 px-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {brandName}
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/hub" className="hover:text-foreground">Public hub</Link>
            <Link href="/leaderboards" className="hover:text-foreground">Leaderboards</Link>
            <Link href="/hall-of-fame" className="hover:text-foreground">Hall of fame</Link>
            <Link href="/sign-in" className="hover:text-foreground">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
