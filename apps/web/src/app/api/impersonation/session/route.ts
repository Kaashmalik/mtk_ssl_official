import { NextRequest, NextResponse } from "next/server";
import { verifyImpersonationToken } from "@mtk/database";
import { claimIssuedImpersonationSession, findImpersonationTarget } from "@/lib/impersonation-ledger";

const WEB_COOKIE = "__ssl_impersonating";

/**
 * GET /api/impersonation/session?token=...
 *
 * Consumes a single-use impersonation token minted by the admin app, claims
 * the ledger session atomically (single-use: the claim itself carries the
 * `status = "issued"` predicate, so a concurrent redemption loses and 409s),
 * and returns the target identity so the web app can show the "viewing as"
 * banner.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const result = await verifyImpersonationToken(token);
    if (!result.ok) {
      return NextResponse.json({ error: `Invalid or expired token (${result.reason})` }, { status: 401 });
    }
    const { jti, targetUserId, targetEmail } = result.payload;

    // Single use, atomically: only one concurrent redemption claims the row.
    const session = await claimIssuedImpersonationSession(jti);
    if (!session) {
      return NextResponse.json({ error: "Token already used or revoked" }, { status: 409 });
    }

    const target = await findImpersonationTarget(targetUserId);

    const res = NextResponse.json({
      success: true,
      target: {
        id: targetUserId,
        email: targetEmail,
        displayName: target?.displayName ?? null,
      },
      adminEmail: session.adminEmail,
      jti,
    });

    res.cookies.set(WEB_COOKIE, JSON.stringify({ email: targetEmail, jti }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 30,
    });

    return res;
  } catch (error) {
    console.error("[impersonation/session]", error);
    return NextResponse.json({ error: "Failed to start impersonation" }, { status: 500 });
  }
}
