import { NextResponse } from "next/server";

/**
 * Client-error beacon receiver (diagnostic).
 *
 * The error boundaries report client exceptions here when no Sentry DSN is
 * configured. The payload is logged to the runtime output verbatim so the
 * live `vercel logs` stream shows the exact client stack, digest, and route —
 * turning "the user sees an error screen and nothing is recorded anywhere"
 * into a captured, correlatable event.
 *
 * Fire-and-forget by contract: never authenticates (client errors can fire
 * pre-auth), never writes to the database, and caps payload size so it
 * cannot be abused as a log-flooding sink.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      source?: unknown;
      message?: unknown;
      stack?: unknown;
      digest?: unknown;
      path?: unknown;
    };

    const source = typeof body.source === "string" ? body.source.slice(0, 64) : "unknown-source";
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "no-message";
    const digest = typeof body.digest === "string" ? body.digest.slice(0, 128) : null;
    const path = typeof body.path === "string" ? body.path.slice(0, 256) : "unknown-path";
    const stack =
      typeof body.stack === "string" && body.stack.length > 0
        ? "\n" + body.stack.slice(0, 4000)
        : " (no stack)";

    console.error(
      `[client-error] source=${source} path=${path} digest=${digest ?? "none"} message=${message}${stack}`,
    );
  } catch {
    console.error("[client-error] received malformed beacon payload");
  }

  // 204: the beacon succeeds silently — reporting must never surface UI.
  return new NextResponse(null, { status: 204 });
}
