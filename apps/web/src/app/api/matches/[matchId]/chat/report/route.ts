import { NextResponse } from "next/server"
import { isUuid } from "@mtk/contracts"
import { reportChatMessage } from "@/lib/match-chat"

export const dynamic = "force-dynamic"

/**
 * ENH-10: POST /api/matches/[matchId]/chat/report { messageId, reason }
 *
 * A league member reports one visible message (native app; the web panel
 * uses the equivalent server action). Fixed reasons only, idempotent, never
 * on your own message - all enforced by the shared writer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  if (!isUuid(matchId)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: { messageId?: unknown; reason?: unknown }
  try {
    body = (await request.json()) ?? {}
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed report body" }, { status: 400 })
  }

  try {
    const result = await reportChatMessage({ matchId, messageId: body.messageId, reason: body.reason })
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.startsWith("Unauthorized")) return NextResponse.json({ ok: false, error: "Sign in to report messages." }, { status: 401 })
    if (message.startsWith("Forbidden") || message === "Tenant not found") {
      return NextResponse.json({ ok: false, error: "Join this league to report messages." }, { status: 403 })
    }
    // Zod refusals from the writer (bad id, unknown reason) are client errors.
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ ok: false, error: "That report is invalid." }, { status: 400 })
    }
    console.error("[match-chat] report failed", error)
    return NextResponse.json({ ok: false, error: "That report could not be sent." }, { status: 503 })
  }
}
