import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources';

/**
 * Model families that reject `temperature` and require `max_completion_tokens`.
 *
 * The gpt-5 family and o-series only accept the default temperature (1), so the
 * previous unconditional `temperature: 0.8` is a hard 400 error on those models.
 * `max_tokens` is likewise deprecated in favour of `max_completion_tokens`.
 */
const REASONING_MODEL_PATTERN = /^(?:gpt-5(?:\.\d+)?|o\d)(?:-|$)/;

/**
 * Builds the request body with the parameters the configured model actually
 * supports, so switching `OPENAI_MODEL` does not require a code change.
 */
export function buildRequest(
  model: string,
  messages: ChatCompletionCreateParamsNonStreaming['messages'],
  maxTokens: number,
  temperature: number,
): ChatCompletionCreateParamsNonStreaming {
  const reasoning = REASONING_MODEL_PATTERN.test(model);

  if (reasoning) {
    return {
      model,
      messages,
      max_completion_tokens: maxTokens,
      // `temperature` deliberately omitted: non-default values are rejected by
      // this family, and omitting it is equivalent to the accepted default.
    };
  }

  return { model, messages, max_tokens: maxTokens, temperature };
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly mockEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
    this.mockEnabled = this.configService.get<string>('OPENAI_MOCK', '') === 'true';

    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.logger.log(`OpenAI client initialized with model: ${this.model}`);
    } else if (this.mockEnabled) {
      this.logger.warn('OpenAI API key not configured - using mock responses (OPENAI_MOCK=true)');
    } else {
      this.logger.warn('OpenAI API key not configured - generation will fail and fall back to templates');
    }
  }

  get isMockEnabled(): boolean {
    return this.mockEnabled;
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Generate text from OpenAI. Real failures THROW — they must be observable
   * by the downstream circuit breaker instead of being masked with mock text.
   */
  async generateText(prompt: string, maxTokens = 100): Promise<string> {
    if (!this.client) {
      if (this.mockEnabled) {
        return this.getMockResponse(prompt);
      }
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.client.chat.completions.create(
        buildRequest(
          this.model,
          [
            {
              role: 'system',
              content: 'You are an expert cricket commentator providing exciting live commentary for Shakir Super League matches. Be enthusiastic, use cricket terminology, and keep responses concise.',
            },
            { role: 'user', content: prompt },
          ],
          maxTokens,
          0.8,
        ),
      );

      return response.choices[0]?.message?.content || 'What a moment in this match!';
    } catch (error) {
      this.logger.error('OpenAI API error', error);
      throw error;
    }
  }

  async generateWithContext(
    systemPrompt: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    maxTokens = 150,
  ): Promise<string> {
    if (!this.client) {
      if (this.mockEnabled) {
        return this.getMockResponse(messages[messages.length - 1]?.content || '');
      }
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.client.chat.completions.create(
        buildRequest(
          this.model,
          [{ role: 'system', content: systemPrompt }, ...messages],
          maxTokens,
          0.7,
        ),
      );

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      this.logger.error('OpenAI API error', error);
      throw error;
    }
  }

  private getMockResponse(prompt: string): string {
    const mockResponses = [
      'What an exciting moment in this match! The crowd is on their feet!',
      'Brilliant cricketing moment here at the Shakir Super League!',
      'The batsman shows great technique with that shot!',
      'The bowler is really putting the pressure on here!',
      'This match is heating up! Every ball counts now!',
      'Superb fielding effort! The crowd loves it!',
      'بہترین شاٹ! کیا کھیل ہے!',
      'کیا چھکا! سٹیڈیم میں جشن کا ماحول!',
    ];

    // Simple logic to return relevant mock response
    if (prompt.toLowerCase().includes('six') || prompt.toLowerCase().includes('چھکا')) {
      return 'What a massive SIX! The ball has gone miles into the stands! کیا چھکا مارا!';
    }
    if (prompt.toLowerCase().includes('wicket')) {
      return 'WICKET! The bowler strikes! This changes everything! وکٹ گر گئی!';
    }
    if (prompt.toLowerCase().includes('four')) {
      return 'FOUR runs! Beautifully timed shot racing to the boundary! خوبصورت چوکا!';
    }

    return mockResponses[Math.floor(Math.random() * mockResponses.length)];
  }
}
