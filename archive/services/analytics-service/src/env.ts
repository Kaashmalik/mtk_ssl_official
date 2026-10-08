import { z } from 'zod';

export const env = z.object({
  PORT: z.coerce.number().default(5003),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
}).parse(process.env);
