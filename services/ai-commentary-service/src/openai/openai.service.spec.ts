/**
 * Model-capability contract for OpenAI request construction.
 *
 * The service picks its model from `OPENAI_MODEL`, so a deployment can switch
 * models purely through configuration. That is only safe if the request body
 * adapts: the gpt-5 family and o-series reject any `temperature` other than the
 * default (a hard 400) and require `max_completion_tokens` instead of the
 * deprecated `max_tokens`.
 *
 * These tests pin both shapes so a future refactor cannot silently regress a
 * configured model into a 400 on the first ball of a live match.
 */

import { buildRequest } from './openai.service';

const messages = [{ role: 'user' as const, content: 'Six runs!' }];

describe('buildRequest', () => {
  describe('legacy chat-completions models', () => {
    it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo'])(
      'sends max_tokens and temperature for %s',
      (model) => {
        const req = buildRequest(model, messages, 100, 0.8);
        expect(req).toMatchObject({
          model,
          max_tokens: 100,
          temperature: 0.8,
        });
      },
    );

    it('does not send max_completion_tokens to legacy models', () => {
      expect(buildRequest('gpt-4o', messages, 100, 0.8)).not.toHaveProperty(
        'max_completion_tokens',
      );
    });
  });

  describe('reasoning / gpt-5 family models', () => {
    it.each([
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'o1',
      'o3-mini',
    ])('omits temperature for %s (rejected by the API)', (model) => {
      const req = buildRequest(model, messages, 100, 0.8);
      expect(req).not.toHaveProperty('temperature');
    });

    it.each([
      'gpt-5',
      'gpt-5.4',
      'gpt-5.4-nano',
      'o3-mini',
    ])('sends max_completion_tokens to %s', (model) => {
      const req = buildRequest(model, messages, 100, 0.8);
      expect(req).toMatchObject({ max_completion_tokens: 100 });
      expect(req).not.toHaveProperty('max_tokens');
    });
  });

  it('preserves the message list and model in both shapes', () => {
    for (const model of ['gpt-4o', 'gpt-5.4-nano']) {
      const req = buildRequest(model, messages, 42, 0.5);
      expect(req.model).toBe(model);
      expect(req.messages).toEqual(messages);
    }
  });
});