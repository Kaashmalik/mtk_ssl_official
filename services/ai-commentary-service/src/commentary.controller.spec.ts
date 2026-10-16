import { CommentaryController } from './commentary.controller';
import { CommentaryService, Commentary } from './commentary.service';
import { ConsumerIdempotencyService } from './consumer-idempotency.service';

const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';

const ballEvent = {
  matchId: MATCH,
  tenantId: TENANT,
  inning: 1,
  over: 3,
  ball: 4,
  runs: 4,
  batsmanName: 'Batter',
  bowlerName: 'Bowler',
  timestamp: new Date().toISOString(),
};

interface MockRedisServer { headers: Record<string, unknown> }
function context(srv?: MockRedisServer) {
  return { getMessage: () => ({ headers: srv?.headers ?? {} }) } as never;
}

describe('Commentary consumer idempotency (dedupe doubles, not real Redis/Kafka)', () => {
  let controller: CommentaryController;
  let commentary: { generateCommentary: jest.Mock; generateMatchIntro: jest.Mock; generateMatchSummary: jest.Mock; publishMatchCommentary: jest.Mock };
  let dedupe: { acquire: jest.Mock; release: jest.Mock };
  const generated: Commentary = { matchId: MATCH, ballId: '3.4', english: 'Four', urdu: 'چار', timestamp: '2026-10-16T12:00:00Z', generatedBy: 'fallback' };

  beforeEach(() => {
    jest.resetAllMocks();
    commentary = {
      generateCommentary: jest.fn().mockResolvedValue(generated),
      generateMatchIntro: jest.fn().mockResolvedValue('Intro text'),
      generateMatchSummary: jest.fn().mockResolvedValue('Summary text'),
      publishMatchCommentary: jest.fn().mockResolvedValue(undefined),
    };
    dedupe = { acquire: jest.fn().mockResolvedValue('claimed'), release: jest.fn().mockResolvedValue(undefined) };
    controller = new CommentaryController(
      commentary as unknown as CommentaryService,
      dedupe as unknown as ConsumerIdempotencyService,
    );
  });

  it('claims and generates commentary under the producer event id', async () => {
    const result = await controller.handleBallEvent(ballEvent as never, context({ headers: { 'idempotency-key': 'event-1' } }));
    expect(result).toBe(generated);
    expect(dedupe.acquire).toHaveBeenCalledWith('ball', 'event-1');
    expect(commentary.generateCommentary).toHaveBeenCalledWith(ballEvent, 'event-1');
    expect(dedupe.release).not.toHaveBeenCalled();
  });

  it('falls back to a deterministic delivery identity without a header or eventId', async () => {
    await controller.handleBallEvent(ballEvent as never, context());
    expect(dedupe.acquire).toHaveBeenCalledWith(
      'ball',
      `tenant:${TENANT}:match:${MATCH}:innings:1:3.4`,
    );
  });

  it('never claims or generates for a malformed ball event', async () => {
    await controller.handleBallEvent({ ...ballEvent, matchId: 'not-a-uuid' } as never, context({ headers: { 'idempotency-key': 'event-2' } }));
    expect(dedupe.acquire).not.toHaveBeenCalled();
    expect(commentary.generateCommentary).not.toHaveBeenCalled();
  });

  it('skips an already-consumed event without regenerating or publishing', async () => {
    dedupe.acquire.mockResolvedValue('duplicate');
    expect(await controller.handleBallEvent(ballEvent as never, context())).toBeNull();
    expect(commentary.generateCommentary).not.toHaveBeenCalled();
    expect(dedupe.release).not.toHaveBeenCalled();
  });

  it('processes without dedupe and never fakes a claim when Redis is unavailable', async () => {
    dedupe.acquire.mockResolvedValue('unavailable');
    expect(await controller.handleBallEvent(ballEvent as never, context())).toBe(generated);
    expect(commentary.generateCommentary).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when generation fails so redelivery can reprocess', async () => {
    commentary.generateCommentary.mockRejectedValue(new Error('Generation failed'));
    expect(await controller.handleBallEvent(ballEvent as never, context({ headers: { 'idempotency-key': 'event-3' } }))).toBeNull();
    expect(dedupe.release).toHaveBeenCalledWith('ball', 'event-3');
  });

  it('does not release a successful claim without an explicit identity', async () => {
    await controller.handleBallEvent({ ...ballEvent, eventId: undefined, batsmanName: undefined, bowlerName: undefined } as never, context());
    expect(dedupe.release).not.toHaveBeenCalled();
  });

  it('publishes the intro under the deterministic match/type identity', async () => {
    const result = await controller.handleMatchEvent({ type: 'MatchStarted', matchId: MATCH, tenantId: TENANT, data: {} }, context());
    expect(result).toBe('Intro text');
    expect(dedupe.acquire).toHaveBeenCalledWith('intro', `${MATCH}:MatchStarted`);
    expect(commentary.publishMatchCommentary).toHaveBeenCalledWith(MATCH, 'Intro text', 'intro', `${MATCH}:MatchStarted`);
  });

  it('regenerates a failed summary on the next delivery by releasing its claim', async () => {
    commentary.generateMatchSummary.mockRejectedValue(new Error('Summary failed'));
    await controller.handleMatchEvent({ type: 'MatchEnded', matchId: MATCH, tenantId: TENANT, data: {} }, context());
    expect(dedupe.release).toHaveBeenCalledWith('summary', `${MATCH}:MatchEnded`);
  });

  it('skips the duplicate summary before any generation', async () => {
    dedupe.acquire.mockResolvedValue('duplicate');
    expect(await controller.handleMatchEvent({ type: 'MatchEnded', matchId: MATCH, tenantId: TENANT, data: {} }, context())).toBeNull();
    expect(commentary.generateMatchSummary).not.toHaveBeenCalled();
    expect(commentary.publishMatchCommentary).not.toHaveBeenCalled();
  });

  it('ignores unknown lifecycle types without claiming or generating', async () => {
    expect(await controller.handleMatchEvent({ type: 'OtherEvent', matchId: MATCH, tenantId: TENANT, data: {} }, context())).toBeNull();
    expect(dedupe.acquire).not.toHaveBeenCalled();
    expect(commentary.generateMatchIntro).not.toHaveBeenCalled();
  });
});
