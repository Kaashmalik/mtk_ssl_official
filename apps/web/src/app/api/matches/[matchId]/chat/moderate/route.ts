import { NextResponse } from "next/server"
import { isUuid } from "@mtk/contracts"
import { moderateChatMessage, muteChatUser } from "@/lib/match-chat"

export const dynamic = "force-dynamic"

/**
 * ENH-10: POST /api/matches/[matchId]/chat/moderate (native moderators; the
 * web console uses the equivalent server actions).
 *
 *   { action: "hide", messageId }          hide for everyone (audited)
 *   { action: "mute", userId, minutes }    timed league-wide mute (audited)
 *
 * Moderator authority is re-derived server-side by the shared writers
 * (`match:update` in the session's league); nothing in the body can grant it.
 * Unpinning stays on the web console.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  if (!isUuid(matchId)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: { action?: unknown; messageId?: unknown; userId?: unknown; minutes?: unknown }
  try {
    const raw = await request.json()
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object")
    body = raw
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed moderation body" }, { status: 400 })
  }

  try {
    if (body.action === "hide") {
      const result = await moderateChatMessage({ matchId, messageId: body.messageId, action: "hide" })
      return NextResponse.json(result, { status: result.ok ? 200 : 404 })
    }
    if (body.action === "mute") {
      const result = await muteChatUser({ matchId, userId: body.userId, minutes: body.minutes })
      return NextResponse.json(result, { status: result.ok ? 200 : 422 })
    }
    return NextResponse.json({ ok: false, error: "Unknown moderation action" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.startsWith("Unauthorized")) return NextResponse.json({ ok: false, error: "Sign in to moderate." }, { status: 401 })
    if (message.startsWith("Forbidden") || message === "Tenant not found") {
      return NextResponse.json({ ok: false, error: "Only league moderators can do that." }, { status: 403 })
    }
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ ok: false, error: "That moderation request is invalid." }, { status: 400 })
    }
    console.error("[match-chat] moderation failed", error)
    return NextResponse.json({ ok: false, error: "That action could not be completed." }, { status: 503 })
  }
}
