import Redis from "ioredis";
import { env } from "../../env";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL not configured");
  }

  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableReadyCheck: true,
    });
  }

  return client;
}