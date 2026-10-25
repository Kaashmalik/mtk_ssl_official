"use client"

import * as React from "react"

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import { Button } from "@mtk/ui/components/ui/button"
import { Card } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Trophy, Activity, Users, Zap, ArrowRight, Compass, BarChart3 } from "lucide-react"
import Link from "next/link"
import { ThemeToggle } from "@mtk/ui/components/theme-toggle"
import { useClerkReady } from "@/components/providers"

export function HomeContent({ brandName }: { brandName: string }) {
  const clerkReady = useClerkReady()

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-primary/20 blur-[128px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-[128px] animate-pulse pointer-events-none" />

      {/* Navbar */}
      <nav className="container relative z-10 mx-auto flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/10 p-2 backdrop-blur-md border border-primary/20">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">{brandName}</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          {clerkReady ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button variant="ghost">Sign In</Button>
                </SignInButton>
                <SignInButton mode="modal">
                  <Button variant="neo-glass" className="rounded-full">Get Started</Button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <Link href="/dashboard">
                  <Button variant="gradient-shine" className="rounded-full">Dashboard</Button>
                </Link>
                <UserButton />
              </SignedIn>
            </>
          ) : (
            <Link href="/sign-in">
              <Button variant="ghost">Sign In</Button>
            </Link>
          )}
        </div>
      </nav>

      <main className="container relative z-10 mx-auto px-6 pt-16 pb-24">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">

          {/* Hero Content */}
          <MotionWrapper variant="fadeInLeft" className="space-y-8">
            <Badge variant="glass" withDot className="pl-4 pr-6 py-1.5 text-sm uppercase tracking-wider backdrop-blur-xl border-primary/20 bg-primary/5">
              Season 2026 Live Now
            </Badge>

            <h1 className="text-fluid-h1 max-w-3xl font-black leading-[1.05] tracking-tighter text-balance">
              Run every match day with <span className="text-primary">clarity and confidence.</span>
            </h1>

            <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
              {brandName} brings tournaments, teams, live scoring, and player performance into one dependable workspace built for organizers and scorers.
            </p>

            <div className="flex flex-wrap gap-4">
              {clerkReady ? (
                <>
                  <SignedOut>
                    <SignInButton mode="modal">
                      <Button
                        size="xl"
                        variant="gradient-shine"
                        className="group shadow-[0_10px_30px_rgba(22,163,74,0.35)] text-white"
                      >
                        Start Your League
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </SignInButton>
                  </SignedOut>
                  <SignedIn>
                    <Link href="/dashboard">
                      <Button size="xl" variant="gradient-shine" className="group">
                        Manage Dashboard
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </Link>
                  </SignedIn>
                </>
              ) : (
                <Link href="/sign-in">
                  <Button
                    size="xl"
                    variant="gradient-shine"
                    className="group shadow-[0_10px_30px_rgba(22,163,74,0.35)] text-white"
                  >
                    Start Your League
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
              )}
              <Button
                size="xl"
                variant="neo-glass"
                className="group border border-border bg-card/80 backdrop-blur-md hover:bg-accent"
                asChild
              >
                <Link href="/hub">
                  <Compass className="mr-2 h-5 w-5 group-hover:text-primary transition-colors" />
                  Explore the platform
                </Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-8 text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <span>Tournaments &amp; Leagues</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <span>Live Scoring</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <span>Pro Analytics</span>
              </div>
            </div>
          </MotionWrapper>

          {/* Product preview */}
          <MotionWrapper variant="fadeInRight" delay={0.2} className="relative">
            <Card variant="glass" className="relative z-10 overflow-hidden p-6 shadow-xl sm:p-8">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Match centre</p>
                  <h2 className="mt-1 text-2xl font-bold">Everything in one view</h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                  <span className="h-2 w-2 rounded-full bg-success" /> Live
                </span>
              </div>
              <div className="grid gap-4 py-6 sm:grid-cols-2">
                {[
                  ["Live scoring", "Ball-by-ball updates for everyone watching", Zap, "text-yellow-500 bg-yellow-500/10"],
                  ["League control", "Fixtures, teams, venues, and registrations", Trophy, "text-primary bg-primary/10"],
                  ["Player insights", "Career stats and match performance", BarChart3, "text-blue-500 bg-blue-500/10"],
                  ["Clear teamwork", "One shared workspace for match day", Users, "text-violet-500 bg-violet-500/10"],
                ].map(([title, description, Icon, tone]) => (
                  <div key={title as string} className="flex gap-3 rounded-lg p-2 transition-colors duration-200 hover:bg-muted/40">
                    <div className={`mt-0.5 rounded-lg p-2 ${tone as string}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{title as string}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{description as string}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-muted/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Tournament readiness</span>
                  <span className="font-bold tabular-nums text-primary">92%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full w-[92%] rounded-full bg-linear-to-r from-primary via-primary to-emerald-400 bg-[length:200%_100%] animate-shimmer shadow-[0_0_10px_-2px] shadow-primary/50" />
                </div>
              </div>
            </Card>
            <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
            <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />
          </MotionWrapper>
        </div>

        <section className="motion-stagger mt-24 grid gap-5 border-y border-border py-8 sm:grid-cols-3">
          {[
            { title: "One workspace", description: "Organize your entire season from one place.", Icon: Trophy },
            { title: "Built for match day", description: "Fast, readable controls for busy grounds.", Icon: Zap },
            { title: "Ready to share", description: "Give players and fans a clear public view.", Icon: Compass },
          ].map(({ title, description, Icon }) => (
            <div key={title} className="group flex gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-muted/40">
              <span aria-hidden="true" className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 transition-transform duration-300 group-hover:scale-110">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="mx-auto mt-20 max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Start with the essentials</p>
          <h2 className="mt-3 text-fluid-h2 font-bold">From first fixture to final score</h2>
          <p className="mt-4 text-muted-foreground">Set up your league, invite your teams, and let the platform keep match day moving.</p>
        </section>
      </main>
    </div>
  )
}
