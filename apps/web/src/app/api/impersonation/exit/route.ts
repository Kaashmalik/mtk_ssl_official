import { NextResponse } from "next/server";
import { verifyImpersonationToken } from "@mtk/database";
import { revokeImpersonationSession } from "@/lib/impersonation-ledger";

const WEB_COOKIE = "__ssl_impersonating";

/**
 * POST /api/impersonation/exit — clears the web-side impersonation marker
 * cookie and revokes the live ledger session when a token is supplied. The
 * cookie is cleared on every path, including errors.
 */
export async function POST(request: Request) {
  try {
    const { token } = (await request.json().catch(() => ({}))) as { token?: string };

    if (token) {
      const result = await verifyImpersonationToken(token);
      if (result.ok) {
        await revokeImpersonationSession(result.payload.jti);
      }
    }

    const res = NextResponse.json({ success: true });
    res.cookies.delete(WEB_COOKIE);
    return res;
  } catch (error) {
    console.error("[impersonation/exit]", error);
    const res = NextResponse.json({ error: "Failed to exit impersonation" }, { status: 500 });
    res.cookies.delete(WEB_COOKIE);
    return res;
  }
}
