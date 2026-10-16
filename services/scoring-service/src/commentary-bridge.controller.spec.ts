import { CommentaryBridgeController } from './commentary-bridge.controller';
import { ScoringGateway } from './scoring.gateway';

jest.mock('./scoring.gateway', () => ({ ScoringGateway: jest.fn() }));

describe('Commentary bridge publication boundary', () => {
  const gateway = { broadcastCommentary: jest.fn() };
  let controller: CommentaryBridgeController;
  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CommentaryBridgeController(gateway as unknown as ScoringGateway);
  });
  it('routes commentary through publication-aware forwarding rather than a bare room emit', async () => {
    const payload = { matchId: '00000000-0000-4000-8000-000000000001', ballId: 'ball', english: 'Four' };
    await controller.handleCommentary(payload as never);
    expect(gateway.broadcastCommentary).toHaveBeenCalledWith(payload);
  });
  it('does not forward an event missing match context', async () => {
    await controller.handleCommentary({ english: 'Four' } as never);
    expect(gateway.broadcastCommentary).not.toHaveBeenCalled();
  });
});
