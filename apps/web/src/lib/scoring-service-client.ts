/**
 * HTTP client for Nest scoring-service (canonical ball-write SoT).
 * Server-actions authenticate the user first, then proxy mutations here.
 *
 * Every mutation also sends the caller's tenant in `x-tenant-id`. The service
 * runs as `service_role`, which bypasses RLS, so this header is what lets it
 * scope each query and reject a cross-tenant id instead of trusting the caller.
 * `tenantId` must therefore always come from the server-side session, never
 * from a value the browser supplied. `x-scoring-actor-id` similarly carries the
 * provisioned database UUID resolved from the authenticated server session.
 * The canonical transaction rechecks active membership and assignment.
 */

import { z } from "zod";
import { ScoringRevisionConflict } from "./scoring-revision-client";

const DEFAULT_SCORING_URL = "http://localhost:4002";

/** Must match `TENANT_HEADER` in the service's `tenant-scope.guard.ts`. */
const TENANT_HEADER = "x-tenant-id";

function scoringBaseUrl(): string {
  return (
    process.env.SCORING_SERVICE_URL?.replace(/\/$/, "") ||
    DEFAULT_SCORING_URL
  );
}

export type ScoringProxyBallInput = {
  matchId: string;
  inningsId: string;
  clientOpId: string;
  over: number;
  ball: number;
  runs: number;
  batsmanId: string;
  bowlerId: string;
  extras?: { type: "wide" | "noball" | "bye" | "legbye"; runs: number };
  wicket?: { type: string; playerId: string; fielderId?: string };
  /** SCORE-11 writer fencing: the handover epoch the scoring session observed. */
  handoverEpoch?: number;
  expectedRevision?: number;
  review?: { reason: string; previousEpoch?: number; previousRevision?: number };
};

export type ScoringProxyBallResult = {
  scoringRevision: number;
  ballId: string;
  clientOpId?: string;
  replayed?: boolean;
  scorecard: {
    matchId: string;
    innings: number;
    totalRuns: number;
    totalWickets: number;
    overs: number;
    balls: number;
    runRate: number;
  };
  /** Batch 100: canonical participant projection, flag-gated on the service
   *  (SCORING_PARTICIPANTS_READY) and absent from older services. */
  participants?: import("@mtk/contracts").ScoringParticipants | null;
};

export type ScoringInnings = {
  scoringRevision?: number;
  id: string;
  matchId: string;
  teamId: string;
  inningsNumber: number;
  status: "not_started" | "in_progress" | "completed";
};

export type ScoringCompleteInningsResult = {
  scoringRevision: number;
  innings: ScoringInnings;
  /** Parent match status after the completion. */
  matchStatus: string;
  /** True when the service applied the `live` -> `innings_break` transition. */
  inningsBreakApplied: boolean;
};

/**
 * Performs a scoring-service call.
 *
 * `tenantId` is required for every mutation: the service rejects a write without
 * it rather than falling back to an unscoped write.
 */
async function scoringFetch<T>(
  path: string,
  init: RequestInit,
  tenantId: string,
  actorId: string,
): Promise<T> {
  const url = `${scoringBaseUrl()}${path}`;
  if (!tenantId) {
    // Fail fast and loudly: a missing tenant would otherwise surface as an
    // opaque 401 from the service, which reads like an auth problem rather than
    // a caller bug.
    throw new Error(
      `scoring-service call to ${path} requires a tenantId (internal programming error)`,
    );
  }
  if (!z.string().uuid().safeParse(actorId).success) {
    throw new Error("Scoring service mutation requires a valid server-derived actor UUID");
  }
  // Internal service token: the web app authenticates the user, then proxies.
  // This never reaches the browser (read from a server-only env var).
  const serviceToken = process.env.SCORING_SERVICE_TOKEN?.trim();
  if (!serviceToken) throw new Error("Scoring service token is not configured");
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set(TENANT_HEADER, tenantId);
  headers.set("x-scoring-actor-id", actorId);
  headers.set("x-scoring-service-token", serviceToken);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(
      `Scoring service unreachable at ${url}. Start services/scoring-service or set SCORING_SERVICE_URL. (${err instanceof Error ? err.message : "network error"})`,
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[]; code?: string; currentRevision?: number };
      if (res.status === 409 && body.code === "SCORING_REVISION_CONFLICT" &&
          Number.isInteger(body.currentRevision) && body.currentRevision! >= 0) {
        throw new ScoringRevisionConflict(body.currentRevision!,
          typeof body.message === "string" ? body.message : undefined);
      }
      if (body.message) {
        detail = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message;
      }
    } catch (error) {
      if (error instanceof ScoringRevisionConflict) throw error;
      /* ignore */
    }
    throw new Error(`Scoring service error (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
}

function requireRevisionAcknowledgement<T extends { scoringRevision?: number }>(response: T): T {
  if (!z.number().int().min(0).max(2147483647).safeParse(response?.scoringRevision).success) {
    throw new Error("Scoring service did not acknowledge a durable revision. Keep saved deliveries and check the coordinated deployment.");
  }
  return response;
}

export async function proxyRecordBall(
  input: ScoringProxyBallInput,
  tenantId: string,
  actorId: string,
): Promise<ScoringProxyBallResult> {
  return requireRevisionAcknowledgement(await scoringFetch<ScoringProxyBallResult>(
    "/scoring/ball",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    tenantId,
    actorId,
  ));
}

/**
 * `handoverEpoch` is optional: the canonical service accepts tokenless writes
 * only while no scorer handover has occurred (SCORE-11 writer fencing).
 */
export async function proxyUndoBall(
  matchId: string,
  ballId: string,
  tenantId: string,
  actorId: string,
  handoverEpoch?: number,
  expectedRevision?: number,
): Promise<ScoringProxyBallResult> {
  return requireRevisionAcknowledgement(await scoringFetch<ScoringProxyBallResult>(
    "/scoring/ball/undo",
    {
      method: "POST",
      body: JSON.stringify({ matchId, ballId, handoverEpoch, expectedRevision }),
    },
    tenantId,
    actorId,
  ));
}

/**
 * Creates an innings. The service owns innings numbering, team validation and
 * the duplicate check, so the web action only has to authorise the caller.
 */
export async function proxyCreateInnings(
  input: {
    matchId: string;
    teamId: string;
    inningsNumber: number;
    handoverEpoch?: number;
    expectedRevision?: number;
  },
  tenantId: string,
  actorId: string,
): Promise<ScoringInnings> {
  return requireRevisionAcknowledgement(await scoringFetch<ScoringInnings>(
    "/scoring/innings",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    tenantId,
    actorId,
  ));
}

/**
 * Completes an innings. `matchId` is sent so the service can scope the innings
 * to its parent match instead of trusting a bare innings id.
 */
export async function proxyCompleteInnings(
  matchId: string,
  inningsId: string,
  tenantId: string,
  actorId: string,
  handoverEpoch?: number,
  expectedRevision?: number,
): Promise<ScoringCompleteInningsResult> {
  return requireRevisionAcknowledgement(await scoringFetch<ScoringCompleteInningsResult>(
    `/scoring/innings/${encodeURIComponent(inningsId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ matchId, handoverEpoch, expectedRevision }),
    },
    tenantId,
    actorId,
  ));
}

/** Match completion stays in the canonical writer, including optional awards. */
export async function proxyCompleteMatch(matchId: string,
  input: { winnerId?: string; result?: string; manOfMatchId?: string; handoverEpoch?: number; expectedRevision?: number },
  tenantId: string, actorId: string,
): Promise<{ success: true; matchId: string; status: "completed"; scoringRevision: number }> {
  const response = await scoringFetch<unknown>(`/scoring/match/${encodeURIComponent(matchId)}/complete`, {
    method: "POST", body: JSON.stringify(input),
  }, tenantId, actorId);
  const accepted = z.object({ success: z.literal(true), matchId: z.literal(matchId), status: z.literal("completed"),
    scoringRevision: z.number().int().min(0).max(2147483647) })
    .safeParse(response);
  if (!accepted.success) throw new Error("Scoring service did not acknowledge this match completion");
  return accepted.data;
}
