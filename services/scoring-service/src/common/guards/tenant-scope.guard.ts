import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TENANT_HEADER = 'x-tenant-id';

/**
 * Resolves the tenant scope for internal scoring mutations.
 *
 * Why this exists
 * ---------------
 * `scoring-service` connects with `service_role`, which **bypasses RLS**. Every
 * handler previously worked from a bare `matchId` / `inningsId`, so the service
 * trusted the caller completely: any request that passed
 * `ScoringServiceAuthGuard` could score, undo, create innings for, or complete an
 * innings belonging to *any* tenant, and no database policy would intervene.
 *
 * This guard makes the tenant an explicit, validated part of the request so the
 * service can scope every query with `eq(table.tenantId, tenantId)` and compare
 * it against the resolved row. The web app derives this header from the Clerk
 * session (`getMyTenant()`), never from user input.
 *
 * Scope of the guarantee — read this before relying on it
 * ------------------------------------------------------
 * This is **defence in depth, not authentication**. It closes the class of bug
 * where the web layer forwards an id it never verified, and it guarantees a
 * caller cannot act outside the tenant it declared. It does **not** stop someone
 * who already holds `SCORING_SERVICE_TOKEN` from declaring a different tenant —
 * that secret is the actual trust boundary, and the primary controls for it are
 * (a) keeping the token server-side and (b) not exposing this service publicly.
 * Treat network isolation + secret hygiene as mandatory; this guard is the layer
 * that catches mistakes, not the layer that stops a determined attacker.
 *
 * Applied to mutation routes only. Read routes stay open so public scoreboards
 * can poll state without a service token.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const raw = request?.headers?.[TENANT_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    // Fail closed. A missing or malformed tenant must never fall back to
    // "no tenant" (i.e. unscoped), which would re-open the original hole.
    if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
      throw new UnauthorizedException(
        `Missing or invalid ${TENANT_HEADER} header`,
      );
    }

    request.tenantId = value.trim();
    return true;
  }
}