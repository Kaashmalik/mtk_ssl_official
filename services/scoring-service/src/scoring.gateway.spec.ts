import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';
import type { Socket, Server } from 'socket.io';
import { publicMatchRoom } from './scoring-public-access';

jest.mock('./scoring.service', () => ({ ScoringService: jest.fn() }));
jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));

const MATCH = '00000000-0000-4000-8000-000000000001';
const TENANT = '00000000-0000-4000-8000-000000000002';
const room = publicMatchRoom(TENANT, MATCH);
describe('Publication-gated exact-league socket reads', () => {
  const service = { getPublicMatchState: jest.fn(), assertPublicMatch: jest.fn(), publishedMatchTenant: jest.fn() };
  const client = { id: 'client-1', connected: true, join: jest.fn(), leave: jest.fn(), emit: jest.fn() };
  let gateway: ScoringGateway;
  const emit = jest.fn();
  const leaveRoom = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    client.connected = true;
    service.getPublicMatchState.mockResolvedValue({ matchId: MATCH, version: 2 });
    service.assertPublicMatch.mockResolvedValue(undefined);
    service.publishedMatchTenant.mockResolvedValue(TENANT);
    gateway = new ScoringGateway(service as unknown as ScoringService);
    gateway.server = { to: jest.fn(() => ({ emit })), in: jest.fn(() => ({ socketsLeave: leaveRoom })) } as unknown as Server;
  });
  const join = () => gateway.handleJoinMatch(client as unknown as Socket, { matchId: MATCH, tenantId: TENANT });
  it('checks publication before joining the exact-league room', async () => {
    expect(await join()).toEqual({ success: true, matchId: MATCH });
    expect(service.getPublicMatchState).toHaveBeenCalledWith(TENANT, MATCH);
    expect(service.getPublicMatchState.mock.invocationCallOrder[0]).toBeLessThan(client.join.mock.invocationCallOrder[0]);
    expect(client.join).toHaveBeenCalledWith(room);
    expect(client.emit).toHaveBeenCalledWith('match-state', { matchId: MATCH, version: 2 });
  });
  it('never joins or emits a snapshot when publication lookup fails', async () => {
    service.getPublicMatchState.mockRejectedValue(new Error('Database unavailable'));
    expect((await join()).success).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.leave).toHaveBeenCalledWith(room);
    expect(gateway.getConnectedClientsCount(TENANT, MATCH)).toBe(0);
  });
  it('does not subscribe invalid IDs', async () => {
    expect((await gateway.handleJoinMatch(client as unknown as Socket, { matchId: 'invalid', tenantId: TENANT })).success).toBe(false);
    expect((await gateway.handleJoinMatch(client as unknown as Socket, { matchId: MATCH } as never)).success).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
  });
  it('broadcasts only freshly publication-checked state to the scoped room', async () => {
    await gateway.broadcastMatchState(TENANT, MATCH);
    expect(service.getPublicMatchState).toHaveBeenCalledWith(TENANT, MATCH);
    expect(gateway.server.to).toHaveBeenCalledWith(room);
    expect(emit).toHaveBeenCalledWith('match-state', { matchId: MATCH, version: 2 });
  });
  it('evicts denied public rooms without reporting a committed mutation as failed', async () => {
    await join();
    service.getPublicMatchState.mockRejectedValue(new Error('Unpublished'));
    await expect(gateway.broadcastMatchState(TENANT, MATCH)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalledWith('match-state', expect.anything());
    expect(emit).toHaveBeenCalledWith('match-unavailable', { tenantId: TENANT, matchId: MATCH });
    expect(leaveRoom).toHaveBeenCalledWith(room);
    expect(gateway.getConnectedClientsCount(TENANT, MATCH)).toBe(0);
  });
  it('does not re-add a client that disconnected during access checking', async () => {
    service.getPublicMatchState.mockImplementation(async () => { client.connected = false; return { matchId: MATCH, version: 2 }; });
    expect((await join()).success).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
  });
  it('does not reject an accepted HTTP write when the room adapter fails during eviction', async () => {
    service.getPublicMatchState.mockRejectedValue(new Error('Unpublished'));
    (gateway.server.in as jest.Mock).mockImplementation(() => { throw new Error('Adapter unavailable'); });
    await expect(gateway.broadcastMatchState(TENANT, MATCH)).resolves.toBeUndefined();
  });
  it('does not reject an accepted HTTP write before the socket server is initialized', async () => {
    gateway.server = undefined;
    await expect(gateway.broadcastMatchState(TENANT, MATCH)).resolves.toBeUndefined();
  });
  it('does not accept reactions from a client outside the approved room', async () => {
    expect((await gateway.handleFanReaction(client as unknown as Socket, { matchId: MATCH, tenantId: TENANT, emoji: '🔥' })).success).toBe(false);
    expect(service.assertPublicMatch).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it('validates reactions, rechecks publication and throttles per connection', async () => {
    await join();
    const payload = { matchId: MATCH, tenantId: TENANT, emoji: '🔥' };
    expect((await gateway.handleFanReaction(client as unknown as Socket, { ...payload, emoji: '<script>' })).success).toBe(false);
    expect((await gateway.handleFanReaction(client as unknown as Socket, payload)).success).toBe(true);
    expect(service.assertPublicMatch).toHaveBeenCalledWith(TENANT, MATCH);
    expect(emit).toHaveBeenCalledWith('fan-reaction', payload);
    expect((await gateway.handleFanReaction(client as unknown as Socket, payload)).success).toBe(false);
    expect(service.assertPublicMatch).toHaveBeenCalledTimes(1);
  });
  it('cannot react across a different declared league', async () => {
    await join();
    expect((await gateway.handleFanReaction(client as unknown as Socket, { matchId: MATCH, tenantId: MATCH, emoji: '🔥' })).success).toBe(false);
    expect(service.assertPublicMatch).not.toHaveBeenCalled();
  });
  it('rejects a reaction after withdrawal of publication', async () => {
    await join();
    service.assertPublicMatch.mockRejectedValue(new Error('Unpublished'));
    expect((await gateway.handleFanReaction(client as unknown as Socket, { matchId: MATCH, tenantId: TENANT, emoji: '🔥' })).success).toBe(false);
    expect(emit).not.toHaveBeenCalledWith('fan-reaction', expect.anything());
    expect(leaveRoom).toHaveBeenCalledWith(room);
  });
  it('cleans room membership and reaction state on disconnect', async () => {
    await join();
    gateway.handleDisconnect(client as unknown as Socket);
    expect(gateway.getConnectedClientsCount(TENANT, MATCH)).toBe(0);
  });
  it('leaves only the exact declared room', async () => {
    await join();
    await gateway.handleLeaveMatch(client as unknown as Socket, { matchId: MATCH, tenantId: TENANT });
    expect(client.leave).toHaveBeenCalledWith(room);
    expect(gateway.getConnectedClientsCount(TENANT, MATCH)).toBe(0);
  });
  it('publication-checks commentary and strips non-allowlisted metadata', async () => {
    await gateway.broadcastCommentary({ matchId: MATCH, ballId: MATCH, english: 'Four runs', timestamp: '2026-10-16T10:00:00Z', generatedBy: 'fallback', privatePrompt: 'secret', tenantId: MATCH });
    expect(service.publishedMatchTenant).toHaveBeenCalledWith(MATCH);
    expect(gateway.server.to).toHaveBeenCalledWith(room);
    const payload = emit.mock.calls.find(([event]) => event === 'commentary-update')![1];
    expect(payload.tenantId).toBe(TENANT);
    expect(payload).not.toHaveProperty('privatePrompt');
  });
  it('does not forward denied or malformed commentary', async () => {
    await gateway.broadcastCommentary({ matchId: 'invalid' });
    expect(service.publishedMatchTenant).not.toHaveBeenCalled();
    service.publishedMatchTenant.mockRejectedValue(new Error('Unpublished'));
    await gateway.broadcastCommentary({ matchId: MATCH, ballId: MATCH, english: 'Four runs', timestamp: '2026-10-16T10:00:00Z', generatedBy: 'fallback' });
    expect(emit).not.toHaveBeenCalled();
  });
});
