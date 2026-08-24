import { Redis } from "ioredis";

import { env } from "@job-scheduler/config";

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

export async function allowRequest(
  key: string,
  limit: number,
  windowSeconds = 60
): Promise<boolean> {
  try {
    if (redis.status === "wait") await redis.connect();
    const bucket = `api-rate:${Math.floor(Date.now() / (windowSeconds * 1000))}:${key}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, windowSeconds);
    return count <= limit;
  } catch {
    console.warn({ event: "redis.unavailable" });
    return true;
  }
}
