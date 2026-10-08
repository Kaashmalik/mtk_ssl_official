export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, users, impersonationSessions } from "@mtk/database";
import { eq } from "drizzle-orm";
import { signImpersonationToken } from "@mtk/database";
import { writeAuditLog } from "@/lib/audit-log";
import { captureError, getRequestLogger } from "@mtk/observability";

const COOKIE_NAME = "__ssl_impersonation";

/**
 * POST /api/impersonate
 *
 * Issues a single-use, signed impersonation token and sets it as an
 * HttpOnly/Secure/SameSite=Lax cookie on the response.  The token is valid
 * for 5 minutes and must be consumed exactly once (see verify route).
 *
 * Request body:
 *   { targetUserId: string, reason?: string }
 */
export async function POST(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { targetUserId, reason } = body as { targetUserId?: string; reason?: string };

    if (!targetUserId || typeof targetUserId !== "string") {
      return NextResponse.json(
        { error: "targetUserId (string) is required" },
        { status: 400 }
      );
    }

    // --- Self-impersonation guard ---
    if (targetUserId === adminId) {
      return NextResponse.json(
        { error: "Cannot impersonate yourself" },
        { status: 400 }
      );
    }

    // --- Look up target user ---
    const [targetUser] = await db
      .select({ id: users.id, email: users.email, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.isActive === false) {
      return NextResponse.json(
        { error: "Cannot impersonate a deactivated user" },
        { status: 403 }
      );
    }

    // --- Look up admin email (for audit trail) ---
    const [adminUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminId))
      .limit(1);

    const adminEmail = adminUser?.email ?? "unknown";

    // --- Sign the impersonation token ---
    const { token, payload } = await signImpersonationToken({
      adminUserId: adminId,
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
    });

    // --- Persist session ledger row (status: issued) ---
    const issuedFromIp =
      request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null;

    await db.insert(impersonationSessions).values({
      jti: payload.jti,
      adminUserId: adminId,
      adminEmail,
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
      issuedFromIp,
      userAgent: request.headers.get("user-agent") ?? null,
      reason: reason ?? null,
      expiresAt: new Date(payload.exp * 1000),
      status: "issued",
    });

    // --- Audit log ---
    await writeAuditLog({
      method: "POST",
      path: "/api/impersonate",
      actorId: adminId,
      actorRole: "super_admin",
      payload: {
        action: "impersonation.issued",
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        reason: reason ?? null,
        jti: payload.jti,
      },
      statusCode: "200",
      request,
    });

    // --- Set HttpOnly/Secure cookie ---
    const webAppUrl = process.env.WEB_APP_URL?.replace(/\/$/, "");
    const response = NextResponse.json({
      success: true,
      message: "Impersonation session issued. Redirecting…",
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
      },
      // One-time handoff to the web app, which consumes the token and
      // displays the "viewing as" banner.
      redirectUrl: webAppUrl
        ? `${webAppUrl}/impersonation/callback?token=${encodeURIComponent(token)}`
        : null,
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 5 * 60, // 5 minutes — matches token TTL
    });

    return response;
  } catch (error) {
    getRequestLogger().error("[impersonate] POST error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/impersonate" },
      tags: { source: "impersonate", method: "POST" },
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/impersonate
 *
 * Revokes any active impersonation session for the current admin and clears
 * the cookie.  Call this to exit impersonation mode.
 */
export async function DELETE(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cookie = request.cookies.get(COOKIE_NAME);
    if (cookie?.value) {
      // Best-effort revocation — we verify the token to get the jti then update
      // the ledger.  If the token is expired or malformed, we simply clear the
      // cookie which is sufficient.
      const { verifyImpersonationToken } = await import("@mtk/database");
      const result = await verifyImpersonationToken(cookie.value);

      if (result.ok) {
        await db
          .update(impersonationSessions)
          .set({ status: "revoked", revokedAt: new Date() })
          .where(eq(impersonationSessions.jti, result.payload.jti));
      }

      await writeAuditLog({
        method: "DELETE",
        path: "/api/impersonate",
        actorId: adminId,
        actorRole: "super_admin",
        payload: { action: "impersonation.revoked" },
        statusCode: "200",
        request,
      });
    }

    const response = NextResponse.json({ success: true, message: "Impersonation ended" });
    response.cookies.delete(COOKIE_NAME);
    return response;
  } catch (error) {
    getRequestLogger().error("[impersonate] DELETE error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/impersonate" },
      tags: { source: "impersonate", method: "DELETE" },
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
