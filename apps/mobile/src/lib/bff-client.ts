import { appApiUrl, currentSessionToken } from "./app-api";
import { MOBILE_BFF_MAX_PAGE_SIZE, type MobileBffListResponse } from "@mtk/contracts";

/**
 * ENH-03-03: THE native client for the authenticated mobile BFF. Every read
 * goes to the web app (bearer session token), which resolves the league and
 * returns contracts projections over cursor pagination. No screen ever
 * talks to the database directly or derives its own query semantics.
 */

export class BffError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Envelope<T> = MobileBffListResponse<T> & { error?: string; detail?: string };

function buildUrl(path: string, params: Record<string, string | null | undefined>): string {
  const qp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") qp.set(key, value);
  }
  const qs = qp.toString();
  return `${appApiUrl()}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * One envelope-carrying GET. `requireToken: false` marks the resource as
 * public (announcements) - an available session token is still attached so
 * the audience gate can personalize, but a signed-out call succeeds.
 */
export async function bffEnvelope<T>(
  path: string,
  params: Record<string, string | null | undefined> = {},
  opts: { requireToken?: boolean } = {},
): Promise<Envelope<T>> {
  const requireToken = opts.requireToken !== false;
  const token = await currentSessionToken();
  if (requireToken && !token) {
    throw new BffError("Sign in to load your league's data", 401);
  }
  const res = await fetch(buildUrl(path, params), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.status === 401) throw new BffError("Session expired - sign in again", 401);
  if (res.status === 403) throw new BffError("No active league for this account", 403);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Envelope<T>;
    throw new BffError(body.detail || body.error || `Request failed (HTTP ${res.status})`, res.status);
  }
  return (await res.json()) as Envelope<T>;
}

/**
 * Pages a cursor-paginated BFF list to exhaustion (no truncated league with
 * >50 fixtures). Safety-capped: the cursor CONTRACT ends the loop; the cap
 * only guards against a server that stops minting cursors.
 */
export async function bffListAll<T>(
  path: string,
  params: Record<string, string | null | undefined> = {},
  opts: { requireToken?: boolean; pageCap?: number } = {},
): Promise<T[]> {
  const acc: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < (opts.pageCap ?? 20); page++) {
    const envelope: MobileBffListResponse<T> = await bffEnvelope<T>(path, { ...params, cursor }, opts);
    acc.push(...envelope.items);
    cursor = envelope.nextCursor;
    if (!cursor) return acc;
  }
  throw new BffError("This list is too large to load - contact support", 508);
}

export { MOBILE_BFF_MAX_PAGE_SIZE };
