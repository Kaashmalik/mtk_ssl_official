import { z } from 'zod';

export const env = z.object({
  PORT: z.coerce.number().default(5004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_ANNOUNCED_IP: z.string().optional(),
  MEDIASOUP_MIN_PORT: z.coerce.number().default(10000),
  MEDIASOUP_MAX_PORT: z.coerce.number().default(10100),
  RTC_MIN_PORT: z.coerce.number().default(40000),
  RTC_MAX_PORT: z.coerce.number().default(49999),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
}).parse(process.env);
