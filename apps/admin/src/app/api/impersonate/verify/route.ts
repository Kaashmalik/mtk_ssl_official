export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db, impersonationSessions } from "@mtk/database";
import { eq, and } from "drizzle-orm";
import { verifyImpersonationToken } from "@mtk/database";
import { writeAuditLog } from "@/lib/audit-log";
import { captureError, getRequestLogger } from "@mtk/observability";

const COOKIE_NAME = "__ssl_impersonation";

/**
 * GET /api/impersonate/verify
 *
 * Validates the impersonation cookie, marks the jti as consumed
 * (single-use), and returns the impersonated user's identity.
 *
 * This is called by the `web` app (or any downstream app) to establish
 * the impersonated context. After a successful call the cookie is no longer
 * valid — the caller must cache the returned identity in a server-side
 * session for the duration of the impersonation window.
 *
 * Response (200):
 *   { ok: true, impersonatedUser: { id, email }, expiresAt: string }
 *
 * Response (401 / 400):
 *   { ok: false, error: string }
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE_NAME);

  if (!cookie?.value) {
    return NextResponse.json(
      { ok: false, error: "No impersonation cookie" },
      { status: 401 }
    );
  }

  // --- Verify token signature + expiry ---
  const result = await verifyImpersonationToken(cookie.value);

  if (!result.ok) {
    const status = result.reason === "expired" ? 401 : 400;
    return NextResponse.json(
      { ok: false, error: `Token ${result.reason}` },
      { status }
    );
  }

  const { payload } = result;

  try {
    // --- Attempt to consume the jti (single-use) ---
    // The partial unique index ensures only one row per jti can be
    // 'active', so a concurrent duplicate verify will get 0 rows updated.
    const [updated] = await db
      .update(impersonationSessions)
      .set({
        status: "active",
        consumedAt: new Date(),
      })
      .where(
        and(
          eq(impersonationSessions.jti, payload.jti),
          eq(impersonationSessions.status, "issued")
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Token already consumed or revoked" },
        { status: 401 }
      );
    }

    // --- Audit ---
    await writeAuditLog({
      method: "GET",
      path: "/api/impersonate/verify",
      actorId: payload.sub,
      actorRole: "super_admin",
      payload: {
        action: "impersonation.consumed",
        targetUserId: payload.targetUserId,
        targetEmail: payload.targetEmail,
        jti: payload.jti,
      },
      statusCode: "200",
      request,
    });

    // --- Clear cookie (single-use) ---
    const response = NextResponse.json({
      ok: true,
      impersonatedUser: {
        id: payload.targetUserId,
        email: payload.targetEmail,
      },
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      issuedBy: payload.sub,
    });

    response.cookies.delete(COOKIE_NAME);
    return response;
  } catch (error) {
    getRequestLogger().error("[impersonate/verify] error", error);
    await captureError(error, {
      level: "error",
      context: { path: "/api/impersonate/verify" },
      tags: { source: "impersonate-verify" },
    });
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
