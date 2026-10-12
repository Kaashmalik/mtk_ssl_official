import type { Request } from 'express';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoringGateway } from './scoring.gateway';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ScoringActorGuard } from './common/guards/scoring-actor.guard';
import { ScoringServiceAuthGuard } from './common/guards/scoring-service-auth.guard';
import { TenantScopeGuard } from './common/guards/tenant-scope.guard';

jest.mock('./scoring.service', () => ({ ScoringService: jest.fn() }));
jest.mock('./scoring.gateway', () => ({ ScoringGateway: jest.fn() }));
const MATCH = '00000000-0000-4000-8000-000000000001';
describe('Post-commit match-state broadcast', () => {
  const service = { recordBall: jest.fn(), undoBall: jest.fn(), createInnings: jest.fn(), completeInnings: jest.fn(), completeMatch: jest.fn() };
  const gateway = { broadcastMatchState: jest.fn() };
  const request = { tenantId: 'tenant', scoringActorId: '00000000-0000-4000-8000-000000000006' } as unknown as Request;
  let controller: ScoringController;
  beforeEach(() => {
    jest.resetAllMocks();
    controller = new ScoringController(service as unknown as ScoringService, gateway as unknown as ScoringGateway);
    for (const mutation of Object.values(service)) mutation.mockResolvedValue({ accepted: true });
    gateway.broadcastMatchState.mockImplementation(async () => {
      const call = Object.values(service).find((mutation) => mutation.mock.calls.length);
      expect(call.mock.results[0].value).toBeInstanceOf(Promise);
      expect(await call.mock.results[0].value).toEqual({ accepted: true });
    });
  });
  function mutate(operation: string) {
    if (operation === 'recordBall') return controller.recordBall(request, {
      matchId: MATCH, inningsId: MATCH, over: 0, ball: 1, runs: 1,
      batsmanId: MATCH, bowlerId: MATCH, clientOpId: 'op',
    });
    if (operation === 'undoBall') return controller.undoBall(request, { matchId: MATCH, ballId: MATCH });
    if (operation === 'createInnings') return controller.createInnings(request, { matchId: MATCH, teamId: MATCH, inningsNumber: 1 });
    if (operation === 'completeInnings') return controller.completeInnings(request, MATCH, { matchId: MATCH });
    return controller.completeMatch(request, MATCH, {});
  }
  it.each(Object.keys(service))('broadcasts a full snapshot after successful %s', async (operation) => {
    await mutate(operation);
    expect(gateway.broadcastMatchState).toHaveBeenCalledWith(MATCH);
    expect(service[operation].mock.calls[0].slice(0, 2)).toEqual(['tenant', '00000000-0000-4000-8000-000000000006']);
  });
  it.each(Object.keys(service))('never broadcasts a rejected %s', async (operation) => {
    service[operation].mockRejectedValue(new Error('Rejected'));
    await expect(mutate(operation)).rejects.toThrow('Rejected');
    expect(gateway.broadcastMatchState).not.toHaveBeenCalled();
  });

  it('does not trust an actor injected into a delivery body', async () => {
    await controller.recordBall(request, { matchId: MATCH, inningsId: MATCH, over: 0, ball: 1, runs: 1,
      batsmanId: MATCH, bowlerId: MATCH, clientOpId: 'op', scoringActorId: 'forged' } as never);
    expect(service.recordBall.mock.calls[0][1]).toBe('00000000-0000-4000-8000-000000000006');
  });

  it('rejects a missing actor before calling the canonical service', async () => {
    await expect(controller.undoBall({ tenantId: 'tenant' } as unknown as Request,
      { matchId: MATCH, ballId: MATCH })).rejects.toThrow('Scoring actor missing');
    expect(service.undoBall).not.toHaveBeenCalled();
  });

  it.each(Object.keys(service))('protects the real %s route with ordered token, tenant, and actor guards', (operation) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ScoringController.prototype[operation]) as unknown[];
    expect(guards.slice(-3)).toEqual([ScoringServiceAuthGuard, TenantScopeGuard, ScoringActorGuard]);
  });
});
