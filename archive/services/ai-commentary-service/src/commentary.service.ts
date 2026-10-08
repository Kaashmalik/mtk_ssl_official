import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIService } from './openai/openai.service';
import { Kafka, Producer } from 'kafkajs';
import Redis from 'ioredis';

export type CommentaryLanguage = 'english' | 'urdu' | 'punjabi' | 'pashto' | 'sindhi';

export interface BallEvent {
  matchId: string;
  tenantId: string;
  inning: number;
  over: number;
  ball: number;
  runs: number;
  extras?: { type: string; runs: number };
  wicket?: { type: string; playerOut: string; dismissedBy?: string };
  batsmanId: string;
  batsmanName: string;
  bowlerId: string;
  bowlerName: string;
  shotType?: string;
  timestamp: string;
}

export interface Commentary {
  matchId: string;
  ballId: string;
  english: string;
  urdu: string;
  punjabi?: string;
  pashto?: string;
  sindhi?: string;
  timestamp: string;
  generatedBy: 'openai' | 'cached' | 'fallback';
}

@Injectable()
export class CommentaryService {
  private readonly logger = new Logger(CommentaryService.name);
  private producer: Producer;
  private redis: Redis | null = null;
  private matchContexts: Map<string, string[]> = new Map();
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private circuitFailureCount = 0;
  private readonly circuitThreshold = 5;
  private readonly circuitTimeoutMs = 30000;
  private circuitResetTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly openaiService: OpenAIService,
  ) {
    this.initKafkaProducer();
    this.initRedis();
  }

  private async initKafkaProducer() {
    const kafka = new Kafka({
      clientId: 'ai-commentary-producer',
      brokers: this.configService.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });
    
    this.producer = kafka.producer();
    await this.producer.connect();
  }

  private initRedis() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
      this.redis.on('error', (err) => {
        this.logger.warn('Redis connection error, falling back to no-cache mode', err.message);
        this.redis = null;
      });
    }
  }

  private getCacheKey(event: BallEvent, language: CommentaryLanguage): string {
    return `commentary:${event.matchId}:${event.over}.${event.ball}:${language}`;
  }

  private async getCachedCommentary(event: BallEvent, language: CommentaryLanguage): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(this.getCacheKey(event, language));
      return cached;
    } catch {
      return null;
    }
  }

  private async setCachedCommentary(event: BallEvent, language: CommentaryLanguage, text: string, ttl = 3600): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(this.getCacheKey(event, language), ttl, text);
    } catch (err) {
      this.logger.warn('Failed to cache commentary', err);
    }
  }

  private async callOpenaiWithCircuitBreaker(prompt: string, maxTokens = 80): Promise<string> {
    if (this.circuitBreakerState === 'open') {
      this.logger.warn('Circuit breaker OPEN - using fallback commentary');
      throw new Error('Circuit breaker open');
    }

    try {
      const result = await this.openaiService.generateText(prompt, maxTokens);
      this.circuitFailureCount = 0;
      if (this.circuitBreakerState === 'half-open') {
        this.circuitBreakerState = 'closed';
      }
      return result;
    } catch (error) {
      this.circuitFailureCount++;
      if (this.circuitFailureCount >= this.circuitThreshold) {
        this.circuitBreakerState = 'open';
        this.logger.error('Circuit breaker tripped - too many OpenAI failures');
        if (this.circuitResetTimer) clearTimeout(this.circuitResetTimer);
        this.circuitResetTimer = setTimeout(() => {
          this.circuitBreakerState = 'half-open';
          this.circuitFailureCount = 0;
          this.logger.log('Circuit breaker moved to half-open');
        }, this.circuitTimeoutMs);
      }
      throw error;
    }
  }

  async generateCommentary(event: BallEvent): Promise<Commentary> {
    const ballId = `${event.over}.${event.ball}`;
    const languages: CommentaryLanguage[] = ['english', 'urdu', 'punjabi', 'pashto', 'sindhi'];
    
    // Build context from recent events
    const context = this.getMatchContext(event.matchId);
    
    // Try cache first for all languages
    const commentaryTexts: Record<string, string> = {};
    const cachedLanguages: CommentaryLanguage[] = [];
    const languagesToGenerate: CommentaryLanguage[] = [];

    for (const lang of languages) {
      const cached = await this.getCachedCommentary(event, lang);
      if (cached) {
        commentaryTexts[lang] = cached;
        cachedLanguages.push(lang);
      } else {
        languagesToGenerate.push(lang);
      }
    }

    // Generate missing languages with circuit breaker
    let generatedBy: Commentary['generatedBy'] = cachedLanguages.length > 0 ? 'cached' : 'fallback';
    
    if (languagesToGenerate.length > 0 && this.circuitBreakerState !== 'open') {
      try {
        const prompts = languagesToGenerate.map((lang) => ({
          lang,
          prompt: this.buildPrompt(event, context, lang),
        }));

        // Batch generate all missing languages in parallel
        const results = await Promise.allSettled(
          prompts.map(async (p) => {
            const text = await this.callOpenaiWithCircuitBreaker(p.prompt, 80);
            return { lang: p.lang, text };
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            commentaryTexts[result.value.lang] = result.value.text;
            await this.setCachedCommentary(event, result.value.lang, result.value.text);
            generatedBy = 'openai';
          }
        }
      } catch (error) {
        this.logger.error('OpenAI generation failed, using fallbacks', error);
      }
    }

    // Fallback for any missing languages
    for (const lang of languagesToGenerate) {
      if (!commentaryTexts[lang]) {
        commentaryTexts[lang] = this.getFallbackCommentary(event, lang);
      }
    }

    const commentary: Commentary = {
      matchId: event.matchId,
      ballId,
      english: commentaryTexts['english'] || this.getFallbackCommentary(event, 'english'),
      urdu: commentaryTexts['urdu'] || this.getFallbackCommentary(event, 'urdu'),
      punjabi: commentaryTexts['punjabi'] || this.getFallbackCommentary(event, 'punjabi'),
      pashto: commentaryTexts['pashto'] || this.getFallbackCommentary(event, 'pashto'),
      sindhi: commentaryTexts['sindhi'] || this.getFallbackCommentary(event, 'sindhi'),
      timestamp: new Date().toISOString(),
      generatedBy,
    };

    // Update context
    this.updateMatchContext(event.matchId, commentary.english);

    // Publish to Kafka
    await this.publishCommentary(commentary);

    return commentary;
  }

  private getFallbackCommentary(event: BallEvent, language: CommentaryLanguage): string {
    const isWicket = !!event.wicket;
    const isSix = event.runs === 6 && !event.extras;
    const isFour = event.runs === 4 && !event.extras;
    const batsman = event.batsmanName;
    const bowler = event.bowlerName;

    const fallbacks: Record<CommentaryLanguage, Record<string, string>> = {
      english: {
        six: `What a SIX! ${batsman} sends it soaring over the ropes!`,
        four: `FOUR runs! ${batsman} finds the boundary with a beautiful shot!`,
        wicket: `WICKET! ${bowler} strikes! ${event.wicket?.playerOut || batsman} is out!`,
        dot: `Good delivery from ${bowler}, dot ball.`,
        runs: `${event.runs} runs taken by ${batsman}.`,
        extra: `${event.extras?.type || 'Extra'} given by ${bowler}.`,
      },
      urdu: {
        six: `کیا چھکا! ${batsman} نے باؤنڈری پار کردی!`,
        four: `شاندار چوکا! ${batsman} نے اچھی شاٹ کھیلی!`,
        wicket: `وکٹ! ${bowler} نے وکٹ حاصل کرلی! ${event.wicket?.playerOut || batsman} آؤٹ!`,
        dot: `اچھی گیند ${bowler} کی جانب سے، ڈاٹ بال!`,
        runs: `${event.runs} رنز ${batsman} نے بنائے۔`,
        extra: `${event.extras?.type || 'اضافی'} رنز۔`,
      },
      punjabi: {
        six: `کیا چھکا! ${batsman} نے باؤنڈری پار کردتی!`,
        four: `شاندار چوکا! ${batsman} نے ودیا شاٹ کھیلی!`,
        wicket: `وکٹ! ${bowler} نے وکٹ لے لی!`,
        dot: `چنگی گیند ${bowler} ولوں، ڈاٹ بال!`,
        runs: `${event.runs} رنز ${batsman} نے بنائے۔`,
        extra: `اضافی رنز۔`,
      },
      pashto: {
        six: `څه شپږیزه! ${batsman} د باؤنډري پورته کړه!`,
        four: `ښه څلوریزه! ${batsman} ښه شاټ ووهله!`,
        wicket: `ویکټ! ${bowler} ویکټ واخیسته!`,
        dot: `ښه بال ${bowler} لخوا، ډاټ بال!`,
        runs: `${event.runs} رنزه ${batsman} واخیستل.`,
        extra: `اضافي رنزه.`,
      },
      sindhi: {
        six: `ڪهڙو ڇڪو! ${batsman} باؤنڊري پار ڪري ڇڏي!`,
        four: `زبردست چوڪا! ${batsman} بهترين شاٽ کيئي!`,
        wicket: `وڪيٽ! ${bowler} وڪيٽ حاصل ڪئي!`,
        dot: `سٺي بال ${bowler} طرفان، ڊاٽ بال!`,
        runs: `${event.runs} رنس ${batsman} ورتا.`,
        extra: `اضافي رنس.`,
      },
    };

    const type = isWicket ? 'wicket' : isSix ? 'six' : isFour ? 'four' : event.runs === 0 ? 'dot' : event.extras ? 'extra' : 'runs';
    return fallbacks[language][type] || fallbacks[language]['runs'];
  }

  async generateMatchIntro(data: Record<string, unknown>): Promise<string> {
    const prompt = `Generate an exciting cricket match introduction:
Team A: ${data.teamAName}
Team B: ${data.teamBName}
Venue: ${data.venueName}
Tournament: ${data.tournamentName}

Write 2-3 sentences to build excitement for this match.`;

    return this.openaiService.generateText(prompt);
  }

  async generateMatchSummary(data: Record<string, unknown>): Promise<string> {
    const prompt = `Generate a cricket match summary:
Winner: ${data.winnerName}
Result: ${data.result}
Player of the Match: ${data.motmName}

Write 2-3 sentences summarizing this exciting match.`;

    return this.openaiService.generateText(prompt);
  }

  private buildPrompt(event: BallEvent, context: string[], language: CommentaryLanguage): string {
    const langInstructions: Record<CommentaryLanguage, string> = {
      english: 'Respond in English. Be enthusiastic like a professional cricket commentator.',
      urdu: 'Respond in Urdu script using cricket terminology. Be enthusiastic like a Pakistani commentator.',
      punjabi: 'Respond in Punjabi script using cricket terminology. Be enthusiastic like a Punjabi commentator.',
      pashto: 'Respond in Pashto script using cricket terminology. Be enthusiastic like a Pashto commentator.',
      sindhi: 'Respond in Sindhi script using cricket terminology. Be enthusiastic like a Sindhi commentator.',
    };
    const langInstruction = langInstructions[language];

    let eventDescription = `Over ${event.over}.${event.ball}: ${event.bowlerName} to ${event.batsmanName}`;
    
    if (event.wicket) {
      eventDescription += ` - WICKET! ${event.wicket.playerOut} is ${event.wicket.type}!`;
    } else if (event.runs === 6) {
      eventDescription += ` - SIX! ${event.shotType || 'Massive hit'}!`;
    } else if (event.runs === 4) {
      eventDescription += ` - FOUR! ${event.shotType || 'Beautiful boundary'}!`;
    } else if (event.runs === 0 && !event.extras) {
      eventDescription += ' - Dot ball.';
    } else {
      eventDescription += ` - ${event.runs} run(s). ${event.shotType || ''}`;
    }

    if (event.extras) {
      eventDescription += ` (${event.extras.type}: ${event.extras.runs})`;
    }

    return `${langInstruction}

Recent context: ${context.slice(-3).join(' ')}

Current ball: ${eventDescription}

Generate 1-2 sentences of live commentary (max 50 words):`;
  }

  private getMatchContext(matchId: string): string[] {
    return this.matchContexts.get(matchId) || [];
  }

  private updateMatchContext(matchId: string, commentary: string) {
    const context = this.getMatchContext(matchId);
    context.push(commentary);
    
    // Keep only last 10 commentaries
    if (context.length > 10) {
      context.shift();
    }
    
    this.matchContexts.set(matchId, context);
  }

  private async publishCommentary(commentary: Commentary) {
    try {
      await this.producer.send({
        topic: 'ssl.commentary',
        messages: [{
          key: commentary.matchId,
          value: JSON.stringify(commentary),
          headers: {
            'content-type': 'application/json',
          },
        }],
      });
    } catch (error) {
      this.logger.error('Failed to publish commentary', error);
    }
  }
}
