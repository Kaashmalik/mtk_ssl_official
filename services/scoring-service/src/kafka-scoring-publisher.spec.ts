import { KafkaScoringPublisher, ScoringBallEventPayload, MatchEventPayload } from './kafka-scoring-publisher.service';

const mockProducer = { connect: jest.fn(), send: jest.fn(), disconnect: jest.fn() };
const mockCreateProducer = jest.fn(() => mockProducer);
jest.mock('kafkajs', () => ({ Kafka: jest.fn().mockImplementation(() => ({ producer: mockCreateProducer })) }));
describe('Outbox publisher broker acknowledgement contract', () => {
  let publisher: KafkaScoringPublisher;
  beforeEach(() => {
    jest.clearAllMocks();
    mockProducer.connect.mockResolvedValue(undefined);
    mockProducer.send.mockResolvedValue([]);
    publisher = new KafkaScoringPublisher();
  });
  it('uses bounded producer retries and in-order inflight sends', () => {
    expect(mockCreateProducer).toHaveBeenCalledWith(expect.objectContaining({ maxInFlightRequests: 1, retry: { retries: 2 } }));
  });
  it.each(['ball', 'match'])('requires all-replica ACKs and stable event ID for %s', async kind => {
    const event = { eventId: 'stable-event', matchId: 'match', type: kind === 'match' ? 'MatchEnded' : 'BALL_RECORDED' };
    if (kind === 'ball') await publisher.publishBallEvent(event as ScoringBallEventPayload);
    else await publisher.publishMatchEvent(event as MatchEventPayload);
    expect(mockProducer.send).toHaveBeenCalledWith(expect.objectContaining({ acks: -1, timeout: 10000,
      messages: [expect.objectContaining({ key: 'match', headers: expect.objectContaining({ 'idempotency-key': 'stable-event' }) })] }));
  });
  it.each(['ball', 'match'])('propagates %s failure so the worker cannot falsely mark delivered', async kind => {
    mockProducer.send.mockRejectedValue(new Error('Broker unavailable'));
    const send = kind === 'ball' ? publisher.publishBallEvent({} as ScoringBallEventPayload) : publisher.publishMatchEvent({} as MatchEventPayload);
    await expect(send).rejects.toThrow('Broker unavailable');
  });
});
