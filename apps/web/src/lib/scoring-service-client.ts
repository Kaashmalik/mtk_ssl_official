/**
 * HTTP client for Nest scoring-service (canonical ball-write SoT).
 * Server-actions authenticate the user first, then proxy mutations here.
 *
 * Every mutation also sends the caller's tenant in `x-tenant-id`. The service
 * runs as `service_role`, which bypasses RLS, so this header is what lets it
 * scope each query and reject a cross-tenant id instead of trusting the caller.
 * `tenantId` must therefore always come from the server-side session, never
 * from a value the browser supplied.
 */

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
};

export type ScoringProxyBallResult = {
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
};

export type ScoringInnings = {
  id: string;
  matchId: string;
  teamId: string;
  inningsNumber: number;
  status: "not_started" | "in_progress" | "completed";
};

export type ScoringCompleteInningsResult = {
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
  // Internal service token: the web app authenticates the user, then proxies.
  // This never reaches the browser (read from a server-only env var).
  const serviceToken = process.env.SCORING_SERVICE_TOKEN?.trim();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        [TENANT_HEADER]: tenantId,
        ...(serviceToken ? { "x-scoring-service-token": serviceToken } : {}),
        ...(init.headers || {}),
      },
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
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) {
        detail = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(`Scoring service error (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
}

export async function proxyRecordBall(
  input: ScoringProxyBallInput,
  tenantId: string,
): Promise<ScoringProxyBallResult> {
  return scoringFetch<ScoringProxyBallResult>(
    "/scoring/ball",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    tenantId,
  );
}

export async function proxyUndoBall(
  matchId: string,
  ballId: string,
  tenantId: string,
): Promise<unknown> {
  return scoringFetch(
    "/scoring/ball/undo",
    {
      method: "POST",
      body: JSON.stringify({ matchId, ballId }),
    },
    tenantId,
  );
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
  },
  tenantId: string,
): Promise<ScoringInnings> {
  return scoringFetch<ScoringInnings>(
    "/scoring/innings",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    tenantId,
  );
}

/**
 * Completes an innings. `matchId` is sent so the service can scope the innings
 * to its parent match instead of trusting a bare innings id.
 */
export async function proxyCompleteInnings(
  matchId: string,
  inningsId: string,
  tenantId: string,
): Promise<ScoringCompleteInningsResult> {
  return scoringFetch<ScoringCompleteInningsResult>(
    `/scoring/innings/${encodeURIComponent(inningsId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ matchId }),
    },
    tenantId,
  );
}
