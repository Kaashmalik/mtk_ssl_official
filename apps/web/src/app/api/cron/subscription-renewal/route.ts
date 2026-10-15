import { NextResponse } from "next/server";
import { logger } from "@mtk/observability";
import { runRenewalSweep, secretsMatch } from "@/lib/subscription-renewal";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron: subscription renewal sweep (daily, see vercel.json `crons`).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on each invocation.
 * The sweep itself (notify buckets + transactional grace-window enforcement)
 * lives in lib/subscription-renewal; this route only authenticates the
 * caller and shapes the response.
 */
export async function GET(request: Request) {
  // --- Authenticate the cron invocation ---
  // Fail closed. Comparing against an unset CRON_SECRET would make
  // `undefined !== undefined` evaluate false and authorise the caller.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error("[cron/subscription-renewal] CRON_SECRET is not set — refusing to run");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!secretsMatch(providedSecret, cronSecret)) {
    logger.warn("[cron/subscription-renewal] Unauthorized cron invocation", {
      hasAuth: Boolean(authHeader),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRenewalSweep(new Date());
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("[cron/subscription-renewal] Sweep failed", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
