import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';

export const ACTOR_HEADER = 'x-scoring-actor-id';

/** Only trusted authenticated server proxies may attest an actor; never a DTO. */
@Injectable()
export class ScoringActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const raw = request?.headers?.[ACTOR_HEADER];
    // Reject duplicate headers, rather than choosing an ambiguous identity.
    const actor = typeof raw === 'string' ? z.string().uuid().safeParse(raw.trim()) : null;
    if (!actor?.success) throw new UnauthorizedException('Missing or invalid scoring actor');
    request.scoringActorId = actor.data;
    return true;
  }
}
