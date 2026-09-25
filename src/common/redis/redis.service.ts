import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Releases a lock only if the caller still owns it (token match), so a
 * process can never release a lock it did not acquire (e.g. after its TTL
 * expired and another process took over).
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Atomic sliding-window-log rate limiter backed by a Redis sorted set.
 * Returns [allowed(0|1), remaining, retryAfterMs].
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfterMs = 0
if oldest[2] ~= nil then
  retryAfterMs = (tonumber(oldest[2]) + windowMs) - now
  if retryAfterMs < 0 then
    retryAfterMs = 0
  end
end
return {0, 0, retryAfterMs}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Attempts to acquire a distributed lock. Returns a unique token on
   * success (required to release safely) or `null` if already held.
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.client.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    } catch (err) {
      this.logger.warn(`Failed to release lock ${key}: ${err}`);
    }
  }

  async slidingWindowRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const member = `${now}-${randomUUID()}`;

    const [allowed, remaining, retryAfterMs] = (await this.client.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now,
      windowMs,
      limit,
      member,
    )) as [number, number, number];

    return {
      allowed: allowed === 1,
      remaining,
      retryAfterMs,
    };
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
