import { NextResponse } from "next/server"
import { isUuid } from "@mtk/contracts"
import { MatchChatUnavailable, pollMatchChat, sendMatchChatMessage } from "@/lib/match-chat"

export const dynamic = "force-dynamic"

/**
 * ENH-10: GET /api/matches/[matchId]/chat?after=<cursor>&since=<iso>
 *
 * The chat poll (ADR 003). Signed-in league members only - chat is never
 * exposed to anonymous visitors. A missing, foreign or unpublished match is a
 * 404 so room existence never leaks across leagues. Responses are private and
 * never cached.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  if (!isUuid(matchId)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const url = new URL(request.url)
  const after = Number(url.searchParams.get("after") ?? 0)
  const sinceRaw = url.searchParams.get("since")
  const since = sinceRaw ? new Date(sinceRaw) : null

  try {
    const poll = await pollMatchChat({
      matchId,
      after: Number.isFinite(after) && after > 0 ? after : 0,
      since: since && !Number.isNaN(since.getTime()) ? since : null,
    })
    return NextResponse.json(poll, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof MatchChatUnavailable) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const failure = authFailure(error)
    if (failure) return failure
    console.error("[match-chat] poll failed", error)
    return NextResponse.json({ error: "Chat is unavailable right now." }, { status: 503 })
  }
}

/** Maps the writer's identity/league refusals to 401/403; null for anything else. */
function authFailure(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message.startsWith("Unauthorized")) {
    return NextResponse.json({ error: "Sign in to join the chat." }, { status: 401 })
  }
  if (message.startsWith("Forbidden") || message === "Tenant not found") {
    return NextResponse.json({ error: "Join this league to take part in the chat." }, { status: 403 })
  }
  return null
}

/**
 * ENH-10: POST /api/matches/[matchId]/chat - send a message (native app;
 * the web panel uses the equivalent server action). Same locked writer, so
 * identity, league, content rules, slow mode and idempotency are identical.
 * The match id comes from the path, never the body.
 *
 * 200 { ok: true, message }    accepted (or an idempotent retry)
 * 422 { ok: false, reason }    refused by policy; `retryAfterSeconds` when timed
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  if (!isUuid(matchId)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    const raw = await request.json()
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object")
    body = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid", error: "Malformed message body" }, { status: 400 })
  }

  try {
    const result = await sendMatchChatMessage({
      matchId,
      body: body.body,
      clientKey: body.clientKey,
      replyToId: body.replyToId ?? null,
      // Pinning is a moderator action from the web console only.
    })
    const headers = { "Cache-Control": "private, no-store" }
    if (result.ok) return NextResponse.json(result, { headers })
    return NextResponse.json(result, {
      status: result.reason === "invalid" ? 400 : 422,
      headers: result.retryAfterSeconds
        ? { ...headers, "Retry-After": String(result.retryAfterSeconds) }
        : headers,
    })
  } catch (error) {
    const failure = authFailure(error)
    if (failure) return failure
    console.error("[match-chat] send failed", error)
    return NextResponse.json({ ok: false, reason: "invalid", error: "That message could not be sent." }, { status: 503 })
  }
}
