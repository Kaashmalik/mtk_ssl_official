import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Admin deep-link bridge: the platform console does not render public match
 * pages, so the live-streams monitor's "Open" action hands off to the web app.
 * The absolute web origin comes from WEB_APP_URL (the same variable the
 * impersonation hand-off uses), never from a guessed domain.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const base = (process.env.WEB_APP_URL ?? "").trim().replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      { error: "WEB_APP_URL is not configured on the admin app" },
      { status: 503 }
    );
  }
  return NextResponse.redirect(`${base}/matches/${encodeURIComponent(id)}/live`);
}
