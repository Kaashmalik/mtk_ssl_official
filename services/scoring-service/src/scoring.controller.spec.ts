import type { Request } from 'express';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoringGateway } from './scoring.gateway';

jest.mock('./scoring.service', () => ({ ScoringService: jest.fn() }));
jest.mock('./scoring.gateway', () => ({ ScoringGateway: jest.fn() }));
const MATCH = '00000000-0000-4000-8000-000000000001';
describe('Post-commit match-state broadcast', () => {
  const service = { recordBall: jest.fn(), undoBall: jest.fn(), createInnings: jest.fn(), completeInnings: jest.fn(), completeMatch: jest.fn() };
  const gateway = { broadcastMatchState: jest.fn() };
  const request = { tenantId: 'tenant' } as unknown as Request;
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
  });
  it.each(Object.keys(service))('never broadcasts a rejected %s', async (operation) => {
    service[operation].mockRejectedValue(new Error('Rejected'));
    await expect(mutate(operation)).rejects.toThrow('Rejected');
    expect(gateway.broadcastMatchState).not.toHaveBeenCalled();
  });
});
