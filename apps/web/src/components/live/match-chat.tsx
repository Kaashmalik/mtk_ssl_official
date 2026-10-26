"use client"

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Flag, Loader2, MessageCircle, Pin, Reply, Send, ShieldCheck, VolumeX, EyeOff, X, ArrowDown } from "lucide-react"
import { toast } from "sonner"
import {
  MATCH_CHAT_MAX_LENGTH,
  MATCH_CHAT_MUTE_MINUTES,
  MATCH_CHAT_POLL_MS,
  MATCH_CHAT_REPORT_REASONS,
  type MatchChatMessage,
  type MatchChatPoll,
  type MatchChatReportReason,
  mergeChatMessages,
} from "@mtk/contracts"
import {
  moderateChatMessageAction,
  muteChatUserAction,
  reportChatMessageAction,
  sendChatMessageAction,
} from "@/app/actions/match-chat"

/**
 * ENH-10-03 match chat panel. Polls /api/matches/[id]/chat (ADR 003).
 *
 * - Auto-scrolls only when the reader is already at the bottom; otherwise a
 *   "new messages" button appears, so incoming chat never yanks the page.
 * - The log itself is not a live region (a busy chat would flood screen
 *   readers); a polite status announces a short count instead.
 * - Polling pauses while the tab is hidden and backs off after errors.
 * - A failed send keeps its client key, so retrying never double-posts.
 */

type Status = "loading" | "ready" | "signin" | "forbidden" | "unavailable" | "error"

const REPORT_LABELS: Record<MatchChatReportReason, string> = {
  abusive: "Abusive",
  spam: "Spam",
  inappropriate: "Inappropriate",
  other: "Other",
}
const MAX_BACKOFF_MS = 30_000

function newClientKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16))
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function MatchChat({ matchId }: { matchId: string }) {
  const [status, setStatus] = useState<Status>("loading")
  const [messages, setMessages] = useState<MatchChatMessage[]>([])
  const [poll, setPoll] = useState<Omit<MatchChatPoll, "messages" | "removedIds"> | null>(null)
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<MatchChatMessage | null>(null)
  const [pinNext, setPinNext] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [unseen, setUnseen] = useState(0)
  const [announcement, setAnnouncement] = useState("")
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const cursorRef = useRef(0)
  const sinceRef = useRef<string | null>(null)
  const clientKeyRef = useRef<string>(newClientKey())
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const backoffRef = useRef(MATCH_CHAT_POLL_MS)

  // Merged outside a state updater: updaters must stay pure (React may run
  // them twice), and the unseen counter is a side effect of the merge.
  const messagesRef = useRef<MatchChatMessage[]>([])
  const merge = useCallback((incoming: MatchChatMessage[], removed: string[]) => {
    const { messages: next, added } = mergeChatMessages(messagesRef.current, incoming, removed)
    messagesRef.current = next
    setMessages(next)
    if (added > 0 && !atBottomRef.current) {
      setUnseen((n) => n + added)
      setAnnouncement(`${added} new chat ${added === 1 ? "message" : "messages"}`)
    }
  }, [])

  const fetchOnce = useCallback(async (): Promise<boolean> => {
    const params = new URLSearchParams({ after: String(cursorRef.current) })
    if (sinceRef.current) params.set("since", sinceRef.current)
    try {
      const res = await fetch(`/api/matches/${matchId}/chat?${params}`, { cache: "no-store" })
      if (res.status === 401) { setStatus("signin"); return false }
      if (res.status === 403) { setStatus("forbidden"); return false }
      if (res.status === 404) { setStatus("unavailable"); return false }
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as MatchChatPoll
      const { messages: incoming, removedIds, ...rest } = data
      merge(incoming, removedIds)
      cursorRef.current = data.cursor
      sinceRef.current = data.serverTime
      setPoll(rest)
      setStatus("ready")
      backoffRef.current = MATCH_CHAT_POLL_MS
      return true
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"))
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
      return true
    }
  }, [matchId, merge])

  // Poll loop: stops for terminal states, pauses while hidden.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (cancelled) return
      if (document.visibilityState === "hidden") { timer = setTimeout(tick, MATCH_CHAT_POLL_MS); return }
      const keepGoing = await fetchOnce()
      if (!cancelled && keepGoing) timer = setTimeout(tick, backoffRef.current)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") { clearTimeout(timer); tick() }
    }
    tick()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [fetchOnce])

  // Keep the reader at the bottom only if they were already there.
  useEffect(() => {
    const el = listRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Countdown tick only while a cooldown or mute is running.
  const mutedUntilMs = poll?.viewer.mutedUntil ? new Date(poll.viewer.mutedUntil).getTime() : null
  const waitingUntil = Math.max(cooldownUntil ?? 0, mutedUntilMs ?? 0)
  useEffect(() => {
    if (waitingUntil <= Date.now()) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waitingUntil])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (atBottomRef.current && unseen > 0) setUnseen(0)
  }

  const jumpToLatest = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setUnseen(0)
  }

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const secondsLeft = Math.max(0, Math.ceil((waitingUntil - now) / 1000))
  const canModerate = poll?.viewer.canModerate === true
  const blockedReason = !poll ? null
    : !poll.postingOpen ? "Chat is closed for this match."
    : poll.viewer.blocked && !canModerate ? "You can't post in this league's chat."
    : mutedUntilMs && mutedUntilMs > now && !canModerate ? `A moderator paused your chat. Try again in ${Math.ceil((mutedUntilMs - now) / 60000)} min.`
    : null

  async function send(event?: React.FormEvent) {
    event?.preventDefault()
    if (sending || !draft.trim() || blockedReason || secondsLeft > 0) return
    setSending(true)
    const result = await sendChatMessageAction({
      matchId,
      body: draft,
      clientKey: clientKeyRef.current,
      replyToId: replyTo?.id ?? null,
      pin: canModerate && pinNext,
    })
    setSending(false)
    if (result.ok && "message" in result) {
      merge([result.message], [])
      if (result.message.pinned) setPoll((p) => (p ? { ...p, pinned: result.message } : p))
      setDraft("")
      setReplyTo(null)
      setPinNext(false)
      clientKeyRef.current = newClientKey()
      atBottomRef.current = true
      if (poll && poll.slowModeSeconds > 0 && !canModerate) setCooldownUntil(Date.now() + poll.slowModeSeconds * 1000)
      return
    }
    // Keep the same client key: a retry must never create a second message.
    if ("retryAfterSeconds" in result && result.retryAfterSeconds) setCooldownUntil(Date.now() + result.retryAfterSeconds * 1000)
    toast.error(result.error)
  }

  async function report(message: MatchChatMessage, reason: MatchChatReportReason) {
    setOpenMenu(null)
    const result = await reportChatMessageAction({ matchId, messageId: message.id, reason })
    if (result.ok) toast.success("Thanks. A moderator will review it.")
    else toast.error(result.error ?? "That report could not be sent.")
  }

  async function hide(message: MatchChatMessage) {
    setOpenMenu(null)
    const result = await moderateChatMessageAction({ matchId, messageId: message.id, action: "hide" })
    if (result.ok) {
      merge([], [message.id])
      setPoll((p) => (p && p.pinned?.id === message.id ? { ...p, pinned: null } : p))
      toast.success("Message hidden for everyone.")
    } else toast.error("error" in result && typeof result.error === "string" ? result.error : "That message could not be hidden.")
  }

  async function unpin(message: MatchChatMessage) {
    const result = await moderateChatMessageAction({ matchId, messageId: message.id, action: "unpin" })
    if (result.ok) setPoll((p) => (p ? { ...p, pinned: null } : p))
    else toast.error("That announcement could not be unpinned.")
  }

  async function mute(message: MatchChatMessage, minutes: number) {
    setOpenMenu(null)
    const result = await muteChatUserAction({ matchId, userId: message.authorId, minutes })
    if (result.ok) toast.success(`${message.authorName} is muted for ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}.`)
    else toast.error(result.error ?? "That person could not be muted.")
  }

  // Terminal / pre-ready states.
  if (status === "unavailable" || (poll && !poll.enabled)) return null
  if (status === "signin" || status === "forbidden") {
    return (
      <ChatFrame>
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {status === "signin" ? (
            <>
              <Link href="/sign-in" className="font-semibold text-primary underline-offset-4 hover:underline">Sign in</Link>{" "}
              to join the match chat.
            </>
          ) : (
            "Join this league as a fan to take part in the match chat."
          )}
        </p>
      </ChatFrame>
    )
  }

  return (
    <ChatFrame slowModeSeconds={poll?.slowModeSeconds}>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {poll?.pinned && (
        <div className="flex items-start gap-2 border-b border-border bg-primary/5 px-4 py-2.5 text-sm">
          <Pin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1"><span className="font-semibold">Announcement: </span>{poll.pinned.body}</p>
          {canModerate && (
            <button type="button" onClick={() => unpin(poll.pinned!)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Unpin announcement">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <div
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          aria-label="Match chat messages"
          tabIndex={0}
          className="h-80 overflow-y-auto px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {status === "loading" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading chat…
            </div>
          ) : status === "error" && messages.length === 0 ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Chat is unavailable right now. It will reconnect automatically.
            </p>
          ) : messages.length === 0 ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              No messages yet. Say something about the match.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {messages.map((m) => {
                const parent = m.replyToId ? byId.get(m.replyToId) : null
                const own = m.authorId === poll?.viewer.id
                return (
                  <li key={m.id} className="group relative rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    {parent && (
                      <p className="mb-0.5 truncate border-l-2 border-border pl-2 text-xs text-muted-foreground">
                        {parent.authorName}: {parent.body}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed">
                      <span className="font-semibold">{m.authorName}</span>
                      {m.isModerator && (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase text-primary">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Mod
                        </span>
                      )}
                      <time className="ml-1.5 text-xs text-muted-foreground" dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
                      <span className="block break-words">{m.body}</span>
                    </p>
                    <div className="absolute right-1 top-1 flex gap-0.5 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                      <IconButton label={`Reply to ${m.authorName}`} onClick={() => setReplyTo(m)}><Reply className="h-3.5 w-3.5" /></IconButton>
                      {!own && (
                        <IconButton label={`Report or moderate ${m.authorName}'s message`} onClick={() => setOpenMenu(openMenu === m.id ? null : m.id)}>
                          <Flag className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>
                    {openMenu === m.id && (
                      <div className="mt-1 flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2 text-xs">
                        <span className="self-center text-muted-foreground">Report:</span>
                        {MATCH_CHAT_REPORT_REASONS.map((reason) => (
                          <button key={reason} type="button" onClick={() => report(m, reason)} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
                            {REPORT_LABELS[reason]}
                          </button>
                        ))}
                        {canModerate && (
                          <>
                            <span className="ml-2 self-center text-muted-foreground">Moderate:</span>
                            <button type="button" onClick={() => hide(m)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted">
                              <EyeOff className="h-3 w-3" aria-hidden="true" /> Hide
                            </button>
                            {!m.isModerator && MATCH_CHAT_MUTE_MINUTES.map((minutes) => (
                              <button key={minutes} type="button" onClick={() => mute(m, minutes)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted">
                                <VolumeX className="h-3 w-3" aria-hidden="true" /> {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {unseen > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> {unseen} new {unseen === 1 ? "message" : "messages"}
          </button>
        )}
      </div>

      <form onSubmit={send} className="border-t border-border p-3">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
            <Reply className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Replying to <strong>{replyTo.authorName}</strong>: {replyTo.body}</span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="rounded p-0.5 hover:bg-background"><X className="h-3 w-3" /></button>
          </div>
        )}
        {blockedReason ? (
          <p className="text-center text-sm text-muted-foreground">{blockedReason}</p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <label htmlFor={`chat-input-${matchId}`} className="sr-only">Message</label>
              <input
                id={`chat-input-${matchId}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MATCH_CHAT_MAX_LENGTH}
                placeholder={status === "ready" ? "Say something about the match…" : "Connecting…"}
                disabled={status !== "ready" || sending}
                autoComplete="off"
                className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending || secondsLeft > 0 || status !== "ready"} aria-label="Send message">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span aria-live="polite">{secondsLeft > 0 ? `Slow mode: wait ${secondsLeft}s` : ""}</span>
              <div className="flex items-center gap-3">
                {canModerate && (
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={pinNext} onChange={(e) => setPinNext(e.target.checked)} /> Pin as announcement
                  </label>
                )}
                <span className="tabular-nums">{draft.length}/{MATCH_CHAT_MAX_LENGTH}</span>
              </div>
            </div>
          </>
        )}
      </form>
    </ChatFrame>
  )
}

function ChatFrame({ children, slowModeSeconds }: { children: React.ReactNode; slowModeSeconds?: number }) {
  return (
    <section aria-labelledby="match-chat-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="match-chat-heading" className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" /> Match chat
        </h2>
        {slowModeSeconds ? <span className="text-xs text-muted-foreground">Slow mode {slowModeSeconds}s</span> : null}
      </div>
      {children}
    </section>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-foreground">
      {children}
    </button>
  )
}
