import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ScoringActorGuard, ACTOR_HEADER } from './scoring-actor.guard';
import { ScoringServiceAuthGuard } from './scoring-service-auth.guard';

const ACTOR = '00000000-0000-7000-8000-000000000006';
function context(request: object) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('Trusted proxy actor guard', () => {
  it('attaches a trimmed database UUIDv7 from the header, not the body', () => {
    const request = { headers: { [ACTOR_HEADER]: ` ${ACTOR} ` }, body: { actorId: 'forged' }, scoringActorId: undefined };
    expect(new ScoringActorGuard().canActivate(context(request))).toBe(true);
    expect(request.scoringActorId).toBe(ACTOR);
  });
  it.each([undefined, '', 'user_clerk', 'invalid', [ACTOR, ACTOR], `${ACTOR},${ACTOR}`])('rejects ambiguous/missing actor %s', (value) => {
    const request = { headers: { [ACTOR_HEADER]: value }, scoringActorId: undefined };
    expect(() => new ScoringActorGuard().canActivate(context(request))).toThrow(UnauthorizedException);
    expect(request.scoringActorId).toBeUndefined();
  });
});

describe('Service authentication has no actor-spoofing development bypass', () => {
  const originalToken = process.env.SCORING_SERVICE_TOKEN;
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.SCORING_SERVICE_TOKEN;
    else process.env.SCORING_SERVICE_TOKEN = originalToken;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });
  it.each(['development', 'test', 'production'])('fails closed without a token in %s', (environment) => {
    process.env.NODE_ENV = environment;
    delete process.env.SCORING_SERVICE_TOKEN;
    expect(() => new ScoringServiceAuthGuard().canActivate(context({ headers: {} }))).toThrow(UnauthorizedException);
  });
  it.each([undefined, '', 'wrong', ['internal-test-secret', 'other']])('rejects bad service credentials %s', (token) => {
    process.env.SCORING_SERVICE_TOKEN = 'internal-test-secret';
    expect(() => new ScoringServiceAuthGuard().canActivate(context({ headers: { 'x-scoring-service-token': token } }))).toThrow(UnauthorizedException);
  });
  it('accepts only matching credentials and normalizes configured whitespace', () => {
    process.env.SCORING_SERVICE_TOKEN = ' internal-test-secret ';
    expect(new ScoringServiceAuthGuard().canActivate(context({ headers: { 'x-scoring-service-token': 'internal-test-secret' } }))).toBe(true);
  });
});
