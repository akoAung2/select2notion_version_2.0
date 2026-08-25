/**
 * Redis Queue Manager
 *
 * Responsibilities:
 * 1. AI job queue  (list key: "queue:ai")
 * 2. Duplicate prevention — processed:{eventId} with 72h TTL (set after worker completes)
 * 3. Telegram send dedup — tg_sent:{eventId}:{uid} with 72h TTL
 *
 * Design rules (fixes for reliability):
 * - enqueueAIJob returns tri-state: "queued" | "duplicate" | "fallback"
 *   "fallback" means "caller must process inline" — never silently drop.
 * - lpush result is validated: null → Redis error → "fallback", not "queued"
 * - setnx ambiguity (null = key-exists OR fetch-error) is avoided by:
 *     a) checking processed:{eventId} (EXISTS) for dedup first
 *     b) using setex (not setnx) for the processing lock — set AFTER successful lpush
 * - Whole enqueue body is wrapped in try/catch so any unexpected Redis error
 *   also becomes "fallback" rather than an uncaught exception.
 */

import * as redis from "./redis.js";
import { logger } from "./logger.js";
import type { AnalysisInput } from "../ai/promptTemplate.js";

export const AI_QUEUE_KEY = "queue:ai";
const PROCESSED_TTL  = 72 * 3600;  // 72 hours — how long to remember a processed event
const LOCK_TTL       = 30 * 60;    // 30 minutes — processing-in-flight lock (short, self-healing)
const TG_SENT_TTL    = 72 * 3600;  // 72 hours — per-user Telegram dedup
const MAX_QUEUE_LEN  = 200;        // safety cap

// ── Job shape ────────────────────────────────────────────────────────────────

export interface AIJob {
  eventId: string;
  eventName: string;
  analysisInput: AnalysisInput;
  usdBias: string;
  riskSentiment: string;
  telegramMessage: string;
  impact?: string;
  currency?: string;
  enqueuedAt: string;
  attempts: number;
}

// ── Duplicate prevention ─────────────────────────────────────────────────────

/** Returns true if this eventId was already fully processed (within 72h). */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  if (!redis.isRedisReady()) return false;
  try {
    return await redis.exists(`processed:${eventId}`);
  } catch {
    return false;
  }
}

/** Mark an event as fully processed (72h TTL). Called by the worker after completion. */
export async function markEventProcessed(eventId: string): Promise<void> {
  if (!redis.isRedisReady()) return;
  try {
    await redis.setex(`processed:${eventId}`, PROCESSED_TTL, "1");
    // Clean up the short in-flight lock — already expired or about to
    await redis.del(`processing:${eventId}`);
  } catch { /* non-critical */ }
}

/** Returns true if Telegram was already sent for this event+user. */
export async function isTelegramSent(eventId: string, uid: string): Promise<boolean> {
  if (!redis.isRedisReady()) return false;
  try {
    return await redis.exists(`tg_sent:${eventId}:${uid}`);
  } catch {
    return false;
  }
}

/** Mark Telegram as sent for event+user (72h TTL). */
export async function markTelegramSent(eventId: string, uid: string): Promise<void> {
  if (!redis.isRedisReady()) return;
  try {
    await redis.setex(`tg_sent:${eventId}:${uid}`, TG_SENT_TTL, "1");
  } catch { /* non-critical */ }
}

// ── AI Job Queue ─────────────────────────────────────────────────────────────

/**
 * Enqueue an AI job.
 *
 * Returns:
 *  "queued"    — job successfully pushed to Redis; caller should return early
 *  "duplicate" — event was already processed or is in-flight; caller should skip
 *  "fallback"  — Redis error or queue full; caller MUST process inline
 *
 * Never silently drops an event.
 */
export async function enqueueAIJob(
  job: Omit<AIJob, "enqueuedAt" | "attempts">,
): Promise<"queued" | "duplicate" | "fallback"> {
  if (!redis.isRedisReady()) return "fallback";

  try {
    // 1. Check if already fully processed (72h dedup via EXISTS — read-only, safe)
    const alreadyDone = await redis.exists(`processed:${job.eventId}`);
    if (alreadyDone) {
      logger.info({ eventId: job.eventId }, "AI job skipped — already processed (dedup)");
      return "duplicate";
    }

    // 2. Check if currently in-flight (short lock — 30 min, self-healing)
    const inFlight = await redis.exists(`processing:${job.eventId}`);
    if (inFlight) {
      logger.info({ eventId: job.eventId }, "AI job skipped — currently in-flight (lock)");
      return "duplicate";
    }

    // 3. Safety cap — avoid unbounded queue growth
    const qLen = await redis.llen(AI_QUEUE_KEY);
    if (qLen >= MAX_QUEUE_LEN) {
      logger.warn({ qLen, eventId: job.eventId }, "AI queue at capacity — falling back to inline");
      return "fallback";
    }

    // 4. Push job to queue — validate result explicitly
    //    lpush returns null on fetch failure (not just "0")
    const payload: AIJob = { ...job, enqueuedAt: new Date().toISOString(), attempts: 0 };
    const newLen = await redis.lpush(AI_QUEUE_KEY, JSON.stringify(payload));
    if (newLen === null || newLen === 0) {
      logger.warn({ eventId: job.eventId }, "Redis lpush returned null/0 — falling back to inline");
      return "fallback";
    }

    // 5. Set in-flight lock AFTER successful enqueue (30 min TTL — self-healing)
    await redis.setex(`processing:${job.eventId}`, LOCK_TTL, "1");

    logger.info({ eventId: job.eventId, qLen: newLen }, "AI job enqueued");
    return "queued";

  } catch (err) {
    logger.warn({ err, eventId: job.eventId }, "Redis enqueue error — falling back to inline");
    return "fallback";
  }
}

/**
 * Dequeue one AI job (RPOP from tail — FIFO order since we LPUSH).
 * Returns null when queue is empty or Redis is unavailable.
 */
export async function dequeueAIJob(): Promise<AIJob | null> {
  if (!redis.isRedisReady()) return null;
  try {
    const raw = await redis.rpop(AI_QUEUE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AIJob;
  } catch (err) {
    logger.warn({ err }, "Failed to dequeue/parse AI job");
    return null;
  }
}

/**
 * Re-enqueue a failed job with incremented attempt counter.
 * Returns true if requeued, false if max retries exceeded OR Redis write failed.
 * Caller logs dead-letter when false is returned.
 */
export async function requeueFailedJob(job: AIJob, MAX_RETRIES = 3): Promise<boolean> {
  if (job.attempts >= MAX_RETRIES) {
    logger.error({ eventId: job.eventId, attempts: job.attempts }, "AI job exceeded max retries — dropping to dead-letter");
    return false;
  }
  try {
    const retried: AIJob = { ...job, attempts: job.attempts + 1 };
    const newLen = await redis.lpush(AI_QUEUE_KEY, JSON.stringify(retried));
    if (newLen === null || newLen === 0) {
      logger.warn({ eventId: job.eventId }, "requeueFailedJob: lpush failed — dead-letter");
      return false;
    }
    logger.warn({ eventId: job.eventId, nextAttempt: retried.attempts }, "AI job re-queued for retry");
    return true;
  } catch (err) {
    logger.warn({ err, eventId: job.eventId }, "requeueFailedJob: error — dead-letter");
    return false;
  }
}
