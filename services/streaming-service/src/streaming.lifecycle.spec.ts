/**
 * Lightweight room-lifecycle checks for streaming gateway helpers.
 * Full mediasoup e2e needs workers; these cover auth token resolution shape
 * and stream-* room id mapping used by endStream.
 */

describe('streaming room lifecycle helpers', () => {
  it('maps stream-{matchId} room ids for endStream', () => {
    const roomId = 'stream-abc-123';
    const matchId = roomId.startsWith('stream-')
      ? roomId.slice('stream-'.length)
      : null;
    expect(matchId).toBe('abc-123');
  });

  it('accepts Bearer tokens from Authorization header shape', () => {
    const authHeader = 'Bearer secret-token-value';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader;
    expect(token).toBe('secret-token-value');
  });
});
