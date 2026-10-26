"use client"

import * as React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { EyeOff, Check, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { MATCH_CHAT_SLOW_MODE_OPTIONS } from "@mtk/contracts"
import {
  dismissChatReportsAction,
  moderateChatMessageAction,
  updateLeagueChatSettingsAction,
} from "@/app/actions/match-chat"
import type { OpenChatReport } from "@/lib/match-chat"

/**
 * ENH-10 owner controls: turn match chat on/off, set slow mode, and work the
 * reported-message queue. Every action re-checks the owner gate server-side.
 */
export function MatchChatSettings({
  initialSettings,
  initialReports,
}: {
  initialSettings: { enabled: boolean; slowModeSeconds: number }
  initialReports: OpenChatReport[]
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [reports, setReports] = useState(initialReports)
  const [isPending, startTransition] = useTransition()

  function save(next: { enabled: boolean; slowModeSeconds: number }) {
    if (next.enabled && !settings.enabled) {
      const ok = confirm(
        "Turn on match chat?\n\nSigned-in fans of your league will be able to post on match pages. You and other league owners are responsible for moderating it: hiding messages, muting people and reviewing reports here."
      )
      if (!ok) return
    }
    startTransition(async () => {
      const result = await updateLeagueChatSettingsAction(next)
      if (result.ok && "settings" in result) {
        setSettings(result.settings)
        toast.success(result.settings.enabled ? "Match chat is on." : "Match chat is off.")
      } else {
        toast.error("error" in result ? result.error : "Chat settings could not be saved.")
      }
    })
  }

  function hide(report: OpenChatReport) {
    startTransition(async () => {
      const result = await moderateChatMessageAction({ matchId: report.matchId, messageId: report.messageId, action: "hide" })
      if (result.ok) {
        setReports((rs) => rs.filter((r) => r.messageId !== report.messageId))
        toast.success("Message hidden and reports closed.")
      } else toast.error("That message could not be hidden.")
    })
  }

  function dismiss(report: OpenChatReport) {
    startTransition(async () => {
      const result = await dismissChatReportsAction({ messageIds: [report.messageId] })
      if (result.ok) {
        setReports((rs) => rs.filter((r) => r.messageId !== report.messageId))
        toast.success("Reports dismissed. The message stays visible.")
      } else toast.error("Reports could not be dismissed.")
    })
  }

  return (
    <section aria-labelledby="chat-settings-heading" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="chat-settings-heading" className="flex items-center gap-2 text-lg font-semibold">
            <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" /> Match chat
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Lets signed-in fans of your league chat on match pages. Links are blocked, messages are plain text,
            and you can hide messages or mute people at any time. Off by default.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-3">
          <span className="text-sm font-medium">{settings.enabled ? "On" : "Off"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Match chat"
            checked={settings.enabled}
            disabled={isPending}
            onChange={(e) => save({ ...settings, enabled: e.target.checked })}
            className="h-5 w-9 cursor-pointer accent-[var(--primary)]"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="chat-slow-mode" className="text-sm font-medium">Slow mode</label>
        <select
          id="chat-slow-mode"
          value={settings.slowModeSeconds}
          disabled={isPending}
          onChange={(e) => save({ ...settings, slowModeSeconds: Number(e.target.value) })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {MATCH_CHAT_SLOW_MODE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 0 ? "Off" : `${s} seconds between messages`}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">Moderators are never slowed down.</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Reported messages</h3>
        {reports.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No open reports.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {reports.map((r) => (
              <li key={r.messageId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm"><span className="font-semibold">{r.authorName}:</span> {r.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.reportCount} {r.reportCount === 1 ? "report" : "reports"} · {r.reasons.join(", ")} ·{" "}
                    <Link href={`/matches/${r.matchId}`} className="underline underline-offset-2">open match</Link>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => dismiss(r)}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Keep
                  </Button>
                  <Button size="sm" variant="destructive" disabled={isPending} onClick={() => hide(r)}>
                    <EyeOff className="mr-1 h-3.5 w-3.5" /> Hide
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
