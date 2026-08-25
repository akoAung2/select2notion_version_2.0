/**
 * Upstash Redis REST client
 *
 * Uses the Upstash HTTP REST API so no TCP socket / native redis client is needed.
 * Every call is a plain fetch — works in any Node.js environment including Replit.
 *
 * Designed to be fault-tolerant: every exported function catches errors and
 * returns a safe default so callers can use Redis opportunistically without
 * crashing when Redis is unavailable.
 */

import { logger } from "./logger.js";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

let _ready = false;
let _latencyMs = 0;

export function isRedisReady(): boolean {
  return _ready;
}

export function getRedisLatencyMs(): number {
  return _latencyMs;
}

// ── Internal REST call ───────────────────────────────────────────────────────
async function redisRequest<T = unknown>(
  ...args: (string | number)[]
): Promise<T | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/${args.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      logger.warn({ status: res.status, text }, "Redis REST error");
      return null;
    }
    const json = await res.json() as { result: T };
    return json.result ?? null;
  } catch (err) {
    logger.warn({ err }, "Redis fetch failed");
    return null;
  }
}

// Pipeline: POST multiple commands at once
async function redisPipeline(commands: (string | number)[][]): Promise<unknown[] | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    const json = await res.json() as { result: unknown }[];
    return json.map((r) => r.result);
  } catch (err) {
    logger.warn({ err }, "Redis pipeline failed");
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Ping Redis and measure latency. Sets _ready flag. */
export async function ping(): Promise<boolean> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    logger.warn("Upstash Redis credentials not set — Redis disabled");
    _ready = false;
    return false;
  }
  const t0 = Date.now();
  try {
    const result = await redisRequest<string>("PING");
    _latencyMs = Date.now() - t0;
    _ready = result === "PONG";
    if (_ready) {
      logger.info({ latencyMs: _latencyMs }, "Redis ping OK");
    } else {
      logger.warn({ result }, "Redis ping returned unexpected value");
      _ready = false;
    }
  } catch (err) {
    logger.warn({ err }, "Redis ping failed");
    _ready = false;
  }
  return _ready;
}

/** SET key value [EX ttlSeconds] */
export async function set(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  const args: (string | number)[] = ["SET", key, value];
  if (ttlSeconds) args.push("EX", ttlSeconds);
  const result = await redisRequest<string>(...args);
  return result === "OK";
}

/** GET key → string | null */
export async function get(key: string): Promise<string | null> {
  return redisRequest<string>("GET", key);
}

/** DEL key */
export async function del(key: string): Promise<void> {
  await redisRequest("DEL", key);
}

/** EXISTS key → boolean */
export async function exists(key: string): Promise<boolean> {
  const result = await redisRequest<number>("EXISTS", key);
  return result === 1;
}

/** LPUSH key value — prepend to list, returns new length */
export async function lpush(key: string, value: string): Promise<number> {
  const result = await redisRequest<number>("LPUSH", key, value);
  return result ?? 0;
}

/** RPOP key — pop from tail of list */
export async function rpop(key: string): Promise<string | null> {
  return redisRequest<string>("RPOP", key);
}

/** LLEN key — list length */
export async function llen(key: string): Promise<number> {
  const result = await redisRequest<number>("LLEN", key);
  return result ?? 0;
}

/** SETEX key ttlSeconds value — set with TTL in one command */
export async function setex(
  key: string,
  ttlSeconds: number,
  value: string,
): Promise<boolean> {
  const result = await redisRequest<string>("SETEX", key, ttlSeconds, value);
  return result === "OK";
}

/** SET key value EX ttl NX — only set if key doesn't exist (atomic lock) */
export async function setnx(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redisRequest<string>("SET", key, value, "EX", ttlSeconds, "NX");
  return result === "OK";
}

export { redisPipeline };
