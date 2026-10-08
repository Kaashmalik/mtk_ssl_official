import { NextRequest, NextResponse } from "next/server";
import { db, impersonationSessions, users } from "@mtk/database";
import { eq, and } from "drizzle-orm";
import { verifyImpersonationToken } from "@mtk/database";

const WEB_COOKIE = "__ssl_impersonating";

/**
 * GET /api/impersonation/session?token=...
 *
 * Consumes a single-use impersonation token minted by the admin app, marks the
 * ledger session as consumed, and returns the target identity so the web app
 * can show the "viewing as" banner.
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

    // Single-use: the ledger row must still be 'issued'
    const [session] = await db
      .select()
      .from(impersonationSessions)
      .where(and(eq(impersonationSessions.jti, jti), eq(impersonationSessions.status, "issued")))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Token already used or revoked" }, { status: 409 });
    }

    await db
      .update(impersonationSessions)
      .set({ status: "active", consumedAt: new Date() })
      .where(eq(impersonationSessions.jti, jti));

    const [user] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    const res = NextResponse.json({
      success: true,
      target: {
        id: targetUserId,
        email: targetEmail,
        displayName: user?.displayName ?? null,
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