import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';
import type { Socket, Server } from 'socket.io';

jest.mock('./scoring.service', () => ({ ScoringService: jest.fn() }));

const MATCH = '00000000-0000-4000-8000-000000000001';
describe('Fresh match join and broadcast', () => {
  const service = { getMatchState: jest.fn() };
  const client = { id: 'client-1', join: jest.fn(), leave: jest.fn(), emit: jest.fn() };
  let gateway: ScoringGateway;
  const emit = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    service.getMatchState.mockResolvedValue({ matchId: MATCH, version: 2 });
    gateway = new ScoringGateway(service as unknown as ScoringService);
    gateway.server = { to: jest.fn(() => ({ emit })) } as unknown as Server;
  });
  it('joins and fetches fresh state instead of a pre-mutation cache', async () => {
    expect(await gateway.handleJoinMatch(client as unknown as Socket, { matchId: MATCH })).toEqual({ success: true, matchId: MATCH });
    expect(service.getMatchState).toHaveBeenCalledWith(MATCH, true);
    expect(client.emit).toHaveBeenCalledWith('match-state', { matchId: MATCH, version: 2 });
  });
  it('rolls back a room subscription when snapshot loading fails', async () => {
    service.getMatchState.mockRejectedValue(new Error('Database unavailable'));
    expect((await gateway.handleJoinMatch(client as unknown as Socket, { matchId: MATCH })).success).toBe(false);
    expect(client.leave).toHaveBeenCalledWith(`match:${MATCH}`);
    expect(gateway.getConnectedClientsCount(MATCH)).toBe(0);
  });
  it('does not subscribe invalid IDs', async () => {
    expect((await gateway.handleJoinMatch(client as unknown as Socket, { matchId: 'invalid' })).success).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
  });
  it('broadcasts complete fresh state to the match room', async () => {
    await gateway.broadcastMatchState(MATCH);
    expect(service.getMatchState).toHaveBeenCalledWith(MATCH, true);
    expect(emit).toHaveBeenCalledWith('match-state', { matchId: MATCH, version: 2 });
  });
  it('does not turn a committed write into a failure when broadcast loading fails', async () => {
    service.getMatchState.mockRejectedValue(new Error('Database unavailable'));
    await expect(gateway.broadcastMatchState(MATCH)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});
