import { NextResponse } from "next/server"
import { isUuid } from "@mtk/contracts"
import { MatchChatUnavailable, pollMatchChat } from "@/lib/match-chat"

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
    const message = error instanceof Error ? error.message : ""
    if (message.startsWith("Unauthorized")) {
      return NextResponse.json({ error: "Sign in to join the chat." }, { status: 401 })
    }
    if (message.startsWith("Forbidden") || message === "Tenant not found") {
      return NextResponse.json({ error: "Join this league to see the chat." }, { status: 403 })
    }
    console.error("[match-chat] poll failed", error)
    return NextResponse.json({ error: "Chat is unavailable right now." }, { status: 503 })
  }
}
