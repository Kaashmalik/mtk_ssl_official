import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Internal service-to-service auth for scoring write endpoints.
 *
 * Browsers never call these endpoints directly: the web app's server actions
 * authenticate the user and then proxy the call (see
 * apps/web/src/lib/scoring-service-client.ts), sending this token in the
 * `x-scoring-service-token` header.
 *
 * Reads (GET) stay open so public scoreboards can poll state.
 */
@Injectable()
export class ScoringServiceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredToken = process.env.SCORING_SERVICE_TOKEN;

    // Fail closed in production; permissive only for local development.
    if (!requiredToken) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException(
          'Scoring service is not configured (SCORING_SERVICE_TOKEN missing)',
        );
      }
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const header = request?.headers?.['x-scoring-service-token'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing scoring service token');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(requiredToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid scoring service token');
    }

    return true;
  }
}