import { NextResponse } from "next/server";
import { db, impersonationSessions } from "@mtk/database";
import { eq } from "drizzle-orm";
import { verifyImpersonationToken } from "@mtk/database";

const WEB_COOKIE = "__ssl_impersonating";

/**
 * POST /api/impersonation/exit — clears the web-side impersonation marker
 * cookie and revokes the ledger session when a token is supplied.
 */
export async function POST(request: Request) {
  try {
    const { token } = (await request.json().catch(() => ({}))) as { token?: string };

    if (token) {
      const result = await verifyImpersonationToken(token);
      if (result.ok) {
        await db
          .update(impersonationSessions)
          .set({ status: "revoked", revokedAt: new Date() })
          .where(eq(impersonationSessions.jti, result.payload.jti));
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