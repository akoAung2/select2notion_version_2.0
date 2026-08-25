/**
 * AI + Telegram Worker Pool
 *
 * Polls the Redis AI queue every POLL_INTERVAL_MS and processes jobs.
 *
 * Per job:
 *   1. Load all users with Telegram connections from Firestore
 *   2. Fan out: for each user, generate AI analysis with THEIR OWN Gemini key in parallel
 *   3. Check Telegram send dedup (tg_sent:{eventId}:{uid}) before sending
 *   4. Send Telegram message to user (warning already sent separately)
 *   5. Save per-user AI report to Firestore ai_reports/{eventId}_{uid}
 *   6. On failure: retry up to 3× with exponential backoff (1s/2s/4s)
 *   7. After all users processed: mark event as processed in Redis
 *
 * Firestore fallback: if Redis is unavailable the event engine runs the
 * direct inline path — this worker only runs when Redis is healthy.
 */

import { logger } from "../lib/logger.js";
import { isRedisReady } from "../lib/redis.js";
import {
  dequeueAIJob,
  requeueFailedJob,
  markEventProcessed,
  isTelegramSent,
  markTelegramSent,
  type AIJob,
} from "../lib/queue.js";
import { generateFundamentalAnalysis, saveAIReport } from "../ai/geminiService.js";
import { sendTelegramMessage, checkUserAllowedPublic, logTelegramAlert } from "../engine/telegramBroadcast.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";

const POLL_INTERVAL_MS   = 2_000;  // poll queue every 2 seconds
const BATCH_SIZE         = 3;      // dequeue up to 3 jobs per poll cycle
const BACKOFF_MS         = [1_000, 2_000, 4_000] as const;
const GEMINI_CONCURRENCY = 5;      // max parallel Gemini calls per job — prevents rate-limit storms

/**
 * Concurrency-limited fan-out. Runs at most `limit` tasks simultaneously.
 * Errors inside `fn` are swallowed here — processJobForUser handles its own errors.
 */
async function withConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<{ successCount: number; failureCount: number }> {
  const executing = new Set<Promise<void>>();
  let successCount = 0;
  let failureCount = 0;
  for (const item of items) {
    const p: Promise<void> = fn(item)
      .then(() => { successCount++; })
      .catch((err) => {
        failureCount++;
        logger.error({ err }, "withConcurrencyLimit: unhandled error in per-user task");
      });
    executing.add(p);
    void p.finally(() => executing.delete(p));
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.allSettled([...executing]);
  return { successCount, failureCount };
}

let _running = false;
let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _processedCount = 0;
let _failureCount   = 0;

export function getWorkerStats() {
  return { running: _running, processedCount: _processedCount, failureCount: _failureCount };
}

// ── Startup ──────────────────────────────────────────────────────────────────

export function startAIWorker(): void {
  if (_intervalHandle) return; // already started
  logger.info("AI worker started — polling Redis queue every 2s");
  _running = true;
  _intervalHandle = setInterval(pollCycle, POLL_INTERVAL_MS);
}

export function stopAIWorker(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  _running = false;
  logger.info({ processedCount: _processedCount, failureCount: _failureCount }, "AI worker stopped");
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function pollCycle(): Promise<void> {
  if (!isRedisReady()) return; // Redis not available — skip silently

  for (let i = 0; i < BATCH_SIZE; i++) {
    const job = await dequeueAIJob();
    if (!job) break; // queue empty
    // Process each job in the background — don't block the poll cycle
    processJobWithRetry(job).catch((err) => {
      logger.error({ err, eventId: job.eventId }, "Unhandled error in AI worker job");
    });
  }
}

// ── Job processing ────────────────────────────────────────────────────────────

async function processJobWithRetry(job: AIJob): Promise<void> {
  const backoff = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length - 1)];
  if (job.attempts > 0) {
    await sleep(backoff);
    logger.info({ eventId: job.eventId, attempt: job.attempts }, "Retrying AI job");
  }

  try {
    await processJob(job);
    _processedCount++;
    await markEventProcessed(job.eventId);
  } catch (err) {
    _failureCount++;
    logger.error({ err, eventId: job.eventId, attempt: job.attempts }, "AI job failed");
    const requeued = await requeueFailedJob(job);
    if (!requeued) {
      // Exceeded retries — log dead letter to Firestore
      await logDeadLetter(job, err).catch(() => {});
    }
  }
}

async function processJob(job: AIJob): Promise<void> {
  if (!isAdminReady()) {
    throw new Error("Firestore not ready — cannot process AI job");
  }

  const db = getAdminDb();

  // Load all Telegram users
  const usersSnap = await db.collection("telegram_connections").get();
  if (usersSnap.empty) {
    logger.info({ eventId: job.eventId }, "No Telegram users — skipping AI job");
    return;
  }

  const users = usersSnap.docs
    // uid is the document ID (not a data field) — always use d.id
    .map((d) => ({ ...(d.data() as { chatId?: number | string }), uid: d.id }))
    .filter((u) => u.chatId);

  logger.info({ eventId: job.eventId, userCount: users.length }, "Processing AI job for users");

  // Fan out: generate per-user AI analysis with a concurrency cap.
  // Without this, 100 users × 3 jobs = 300 simultaneous Gemini calls → rate limits.
  const { successCount, failureCount } = await withConcurrencyLimit(
    users,
    GEMINI_CONCURRENCY,
    (user) => processJobForUser(job, user.chatId!, user.uid),
  );
  logger.info({ eventId: job.eventId, successCount, failureCount }, "AI job fan-out complete");
}

async function processJobForUser(
  job: AIJob,
  chatId: number | string,
  uid?: string,
): Promise<void> {
  // Check Telegram dedup
  const dupKey = uid ?? String(chatId);
  const alreadySent = await isTelegramSent(job.eventId, dupKey);
  if (alreadySent) {
    logger.info({ eventId: job.eventId, uid }, "Telegram already sent to user — skipping");
    return;
  }

  // Check user's notification settings
  if (uid) {
    const allowed = await checkUserAllowedPublic(uid, {
      impact: job.impact as "high" | "medium" | "low" | undefined,
      currency: job.currency,
    });
    if (!allowed) return;
  }

  // Generate AI analysis using user's own Gemini key (key resolved internally)
  const analysis = await generateFundamentalAnalysis(job.analysisInput, uid ?? null, job.eventId);

  // Build the full message with user-specific AI output injected
  const message = job.telegramMessage.includes(analysis)
    ? job.telegramMessage
    : appendAnalysis(job.telegramMessage, analysis);

  // Send Telegram
  await sendTelegramMessage(chatId, message);
  await markTelegramSent(job.eventId, dupKey);

  // Persist per-user AI report to Firestore
  if (uid && isAdminReady()) {
    const reportId = `${job.eventId}_${uid}`;
    await getAdminDb()
      .collection("ai_reports")
      .doc(reportId)
      .set({
        eventId: job.eventId,
        eventName: job.eventName,
        userId: uid,
        analysis,
        usdBias: job.usdBias,
        riskSentiment: job.riskSentiment,
        generatedAt: new Date().toISOString(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 72 * 3600_000),
      })
      .catch((err) => logger.warn({ err, reportId }, "Failed to save per-user AI report"));
  }

  await logTelegramAlert("release", job.eventName, message).catch(() => {});
  logger.info({ eventId: job.eventId, uid }, "AI analysis sent to user");
}

function appendAnalysis(baseMessage: string, analysis: string): string {
  // Replace trailing analysis section if present, otherwise append
  const sep = "\n\n---\n";
  const idx = baseMessage.lastIndexOf(sep);
  if (idx !== -1) return baseMessage.slice(0, idx) + sep + analysis;
  return `${baseMessage}\n\n${analysis}`;
}

async function logDeadLetter(job: AIJob, err: unknown): Promise<void> {
  if (!isAdminReady()) return;
  await getAdminDb()
    .collection("ai_errors")
    .add({
      eventId: job.eventId,
      eventName: job.eventName,
      attempts: job.attempts,
      error: err instanceof Error ? err.message : String(err),
      failedAt: new Date(),
    })
    .catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
