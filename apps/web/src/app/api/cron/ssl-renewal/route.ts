import { NextResponse } from "next/server";
import { captureError, logger } from "@mtk/observability";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron: SSL certificate renewal sweep.
 *
 * Triggered daily by Vercel Cron (see vercel.json `crons` config).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on each invocation.
 *
 * This route is a thin dispatcher — it calls the NestJS API service's
 * /ssl/renew endpoint, which contains the actual ACME renewal logic.
 * Keeping the ACME code in the API service means there's ONE place that
 * holds the Let's Encrypt account key and certificate storage paths.
 *
 * Env:
 *   CRON_SECRET       — shared secret Vercel sends (must match vercel.json)
 *   API_SERVICE_URL   — base URL of the NestJS API service
 *   SSL_ADMIN_TOKEN   — secret the API's /ssl/renew endpoint expects
 *
 * If API_SERVICE_URL is not set, the route no-ops with a warning (useful in
 * dev/preview where the API service isn't running).
 */
export async function GET(request: Request) {
  // --- Authenticate the cron invocation ---
  const authHeader = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("[cron/ssl-renewal] CRON_SECRET is not set — refusing to run");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("[cron/ssl-renewal] Unauthorized cron invocation", {
      hasAuth: Boolean(authHeader),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiUrl = process.env.API_SERVICE_URL;
  const sslToken = process.env.SSL_ADMIN_TOKEN || cronSecret;

  if (!apiUrl) {
    logger.warn(
      "[cron/ssl-renewal] API_SERVICE_URL is not set — skipping renewal (API service not deployed)"
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "API_SERVICE_URL not configured",
    });
  }

  // --- Call the API service's renewal endpoint ---
  const endpoint = `${apiUrl.replace(/\/$/, "")}/ssl/renew`;
  const started = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-ssl-secret": sslToken,
        "Content-Type": "application/json",
      },
      // Renewal can take a while if multiple certs need re-issuance.
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min
    });

    const body = await res.json().catch(() => ({}));
    const durationMs = Date.now() - started;

    if (!res.ok) {
      logger.error("[cron/ssl-renewal] API service returned error", {
        status: res.status,
        durationMs,
        body,
      });
      return NextResponse.json(
        { ok: false, error: "Renewal failed", status: res.status, body },
        { status: 502 }
      );
    }

    logger.info("[cron/ssl-renewal] Renewal sweep complete", {
      durationMs,
      result: body,
    });

    return NextResponse.json({ ok: true, durationMs, result: body });
  } catch (err) {
    const durationMs = Date.now() - started;
    logger.error("[cron/ssl-renewal] Failed to call API service", err, {
      endpoint,
      durationMs,
    });
    await captureError(err, {
      level: "error",
      context: { source: "cron-ssl-renewal", endpoint },
      tags: { source: "cron" },
    });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
