"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { X, Zap, Clock } from "lucide-react"
import { Button } from "@mtk/ui/components/ui/button"

interface TrialBannerProps {
  daysRemaining: number
  plan: string
}

const DISMISS_KEY = "trial_banner_dismissed_until"

/**
 * Trial banner shown in the dashboard shell when the tenant's subscription is
 * `status = 'trialing'`.
 *
 * The banner is dismissable — clicking × sets a localStorage timestamp so it
 * re-appears after 24 h (so the user is reminded daily but not spammed).
 *
 * This is a client component so it can read localStorage without hydration
 * mismatches. The server component (`TrialBannerServer`) resolves the
 * subscription state and passes props in.
 */
export function TrialBanner({ daysRemaining, plan }: TrialBannerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const until = localStorage.getItem(DISMISS_KEY)
      if (until && Date.now() < Number(until)) {
        // Still within the dismiss window — stay hidden
        return
      }
    } catch {
      // localStorage may be unavailable (private browsing, SSR guard)
    }
    setVisible(true)
  }, [])

  function dismiss() {
    try {
      // Re-show after 24 h
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 86_400_000))
    } catch {
      // ignore
    }
    setVisible(false)
  }

  if (!visible) return null

  const isUrgent = daysRemaining <= 3

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`relative flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors
        ${isUrgent
          ? "bg-orange-500/15 border-b border-orange-500/30 text-orange-700 dark:text-orange-300"
          : "bg-purple-500/10 border-b border-purple-500/20 text-purple-700 dark:text-purple-300"
        }`}
    >
      {/* Icon */}
      <span className={`shrink-0 rounded-full p-1
        ${isUrgent ? "bg-orange-500/20" : "bg-purple-500/20"}`}
      >
        {isUrgent
          ? <Clock className="h-3.5 w-3.5" />
          : <Zap className="h-3.5 w-3.5" />
        }
      </span>

      {/* Message */}
      <span className="flex-1">
        {isUrgent
          ? <>Your <strong>{plan}</strong> trial ends in <strong>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}</strong>. Upgrade now to keep your features.</>
          : <>You&apos;re on a free <strong>{plan}</strong> trial &mdash; <strong>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}</strong> remaining.</>
        }
      </span>

      {/* CTA */}
      <Button
        asChild
        size="sm"
        variant={isUrgent ? "default" : "outline"}
        className={`h-7 px-3 text-xs shrink-0
          ${isUrgent
            ? "bg-orange-600 hover:bg-orange-700 text-white border-transparent"
            : "border-purple-400/50 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
          }`}
      >
        <Link href="/dashboard/settings/billing">Upgrade Now</Link>
      </Button>

      {/* Dismiss */}
      <button
        aria-label="Dismiss trial banner"
        onClick={dismiss}
        className="shrink-0 rounded p-1 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
