"use client"

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import { Button } from "@mtk/ui/components/ui/button"
import { Card } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Trophy, Activity, Users, Zap, ArrowRight, PlayCircle } from "lucide-react"
import Link from "next/link"
import { ThemeToggle } from "@mtk/ui/components/theme-toggle"
import { useClerkReady } from "@/components/providers"

export function HomeContent() {
  const clerkReady = useClerkReady()

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-primary/20 blur-[128px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-[128px] animate-pulse pointer-events-none" />

      {/* Navbar */}
      <nav className="container relative z-10 mx-auto flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/10 p-2 backdrop-blur-md border border-primary/20">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">Shakir Super League</span>
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

      <main className="container relative z-10 mx-auto px-6 pt-16 pb-32">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">

          {/* Hero Content */}
          <MotionWrapper variant="fadeInLeft" className="space-y-8">
            <Badge variant="glass" withDot className="pl-4 pr-6 py-1.5 text-sm uppercase tracking-wider backdrop-blur-xl border-primary/20 bg-primary/5">
              Season 2026 Live Now
            </Badge>

            <h1 className="text-fluid-h1 font-black leading-tight tracking-tighter text-balance">
              Pakistan&apos;s <span className="text-primary">#1 Cricket</span> Tournament Platform
            </h1>

            <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
              Experience crickets like never before. Real-time scoring, pro-level analytics, and league management for the next generation of champions.
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
                className="group border border-white/25 bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
              >
                <PlayCircle className="mr-2 h-5 w-5 group-hover:text-primary transition-colors" />
                Watch Demo
              </Button>
            </div>

            <div className="flex items-center gap-8 pt-8 text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <span>500+ Teams</span>
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

          {/* Hero Visual / Features Grid */}
          <MotionWrapper variant="fadeInRight" delay={0.2} className="relative">
            <div className="relative z-10 grid gap-6 sm:grid-cols-2">
              <Card variant="glass" hoverEffect="glow" className="p-6">
                <div className="mb-4 rounded-full bg-green-500/10 w-fit p-3">
                  <Zap className="h-6 w-6 text-green-500" />
                </div>
                <h3 className="text-lg font-bold">Live Scoring</h3>
                <p className="mt-2 text-sm text-muted-foreground">Ball-by-ball updates with zero latency WebSocket connections.</p>
              </Card>
              <Card variant="neo" hoverEffect="lift" className="p-6 sm:mt-8">
                <div className="mb-4 rounded-full bg-blue-500/10 w-fit p-3">
                  <Activity className="h-6 w-6 text-blue-500" />
                </div>
                <h3 className="text-lg font-bold">Analytics</h3>
                <p className="mt-2 text-sm text-muted-foreground">Advanced player stats, worm graphs, and match insights.</p>
              </Card>
              <Card variant="neo" hoverEffect="lift" className="p-6">
                <div className="mb-4 rounded-full bg-purple-500/10 w-fit p-3">
                  <Users className="h-6 w-6 text-purple-500" />
                </div>
                <h3 className="text-lg font-bold">Team Mgmt</h3>
                <p className="mt-2 text-sm text-muted-foreground">Draft players, manage squads, and generate lineups automatically.</p>
              </Card>
              <Card variant="glass" hoverEffect="glow" className="p-6 sm:mt-8">
                <div className="mb-4 rounded-full bg-orange-500/10 w-fit p-3">
                  <Trophy className="h-6 w-6 text-orange-500" />
                </div>
                <h3 className="text-lg font-bold">Tournaments</h3>
                <p className="mt-2 text-sm text-muted-foreground">Automated fixtures, points tables, and knockout brackets.</p>
              </Card>
            </div>

            {/* Decorative Background for cards */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-linear-to-tr from-primary/10 to-blue-500/10 blur-3xl -z-10" />
          </MotionWrapper>

        </div>
      </main>
    </div>
  )
}
