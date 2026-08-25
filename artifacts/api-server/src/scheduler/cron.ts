/**
 * Cron Scheduler
 *
 * Two separate concerns:
 *
 *  DATA SYNC  (calls external provider APIs):
 *   • Normal mode:      every 30 minutes  — invalidates cache, triggers provider cascade
 *   • High-impact mode: every  5 minutes  — when a high-impact event is within 2 hours
 *
 *  RELEASE DETECTION  (uses in-memory cache only — no API calls):
 *   • Every 30 seconds — checks for newly released events, fires Telegram warnings
 *
 * Provider cascade (handled by economicCalendarService):
 *   FMP → Alpha Vantage → FRED → Firestore cache
 */

import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger.js";
import {
  pollCycle, getCachedCalendar, invalidateCache, setHighImpactMode,
} from "../news/polling/pollingEngine.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";

let detectionTask: ScheduledTask | null = null;    // 30 s — release detection
let normalSyncTask: ScheduledTask | null = null;   // 30 min — data sync
let highImpactTask: ScheduledTask | null = null;   // 5 min — data sync (high-impact)
let cleanupTask: ScheduledTask | null = null;
let isHighImpactMode = false;

// ── Mode detection ─────────────────────────────────────────────────────────────

function hasUpcomingHighImpact(): boolean {
  const events = getCachedCalendar();
  const now = Date.now();
  return events.some((e) => {
    if (e.impact !== "high") return false;
    const diff = new Date(e.time).getTime() - now;
    return diff > 0 && diff <= 2 * 3600_000; // within 2 hours
  });
}

// ── Data sync ─────────────────────────────────────────────────────────────────

async function runDataSync(): Promise<void> {
  logger.info({ mode: isHighImpactMode ? "high-impact" : "normal" }, "Calendar sync started");
  invalidateCache(); // force a fresh provider fetch
  await pollCycle();

  // Re-evaluate high-impact mode after fetch
  const shouldBeHighImpact = hasUpcomingHighImpact();
  if (shouldBeHighImpact && !isHighImpactMode) {
    logger.info("Switching to HIGH IMPACT mode (5 min data sync)");
    isHighImpactMode = true;
    setHighImpactMode(true);
    enableHighImpactSync();
  } else if (!shouldBeHighImpact && isHighImpactMode) {
    logger.info("Reverting to NORMAL mode (30 min data sync)");
    isHighImpactMode = false;
    setHighImpactMode(false);
    disableHighImpactSync();
  }

  const nextSyncMin = isHighImpactMode ? 5 : 30;
  const nextSyncAt = new Date(Date.now() + nextSyncMin * 60_000).toISOString();
  logger.info({ nextSyncAt, nextSyncMin, mode: isHighImpactMode ? "high-impact" : "normal" },
    "Calendar sync complete");
}

function enableHighImpactSync(): void {
  if (highImpactTask) return;
  highImpactTask = cron.schedule("*/5 * * * *", async () => {
    if (!isHighImpactMode) return;
    await runDataSync();
  });
  logger.info("High-impact sync task started (every 5 min)");
}

function disableHighImpactSync(): void {
  if (highImpactTask) {
    highImpactTask.stop();
    highImpactTask = null;
    logger.info("High-impact sync task stopped");
  }
}

// ── Firestore cleanup ─────────────────────────────────────────────────────────

async function cleanupExpiredData(): Promise<void> {
  if (!isAdminReady()) return;
  const db = getAdminDb();
  const now = new Date();

  const collections: Array<{ name: string; field?: string; cutoff?: Date }> = [
    { name: "news_cache" },
    { name: "ai_reports" },
    { name: "telegram_logs" },
    { name: "economic_events" },   // upcoming events — 7-day TTL
    { name: "released_events" },   // released events — 72h TTL
    { name: "ai_news_analysis" },
    { name: "calendar_errors" },   // provider error log — 7-day TTL
    { name: "ai_errors",    field: "failedAt", cutoff: new Date(Date.now() - 7 * 24 * 3600_000) },
  ];

  try {
    let totalCleaned = 0;
    await Promise.allSettled(
      collections.map(async ({ name, field = "expiresAt", cutoff = now }) => {
        const snap = await db.collection(name)
          .where(field, "<", cutoff)
          .limit(100)
          .get()
          .catch(() => null);
        if (!snap || snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        totalCleaned += snap.size;
      }),
    );
    if (totalCleaned > 0) logger.info({ totalCleaned }, "Expired data cleaned from Firestore");
  } catch (err) {
    logger.error({ err }, "Cleanup task error");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  logger.info("Starting news intelligence scheduler...");

  // Startup: initial sync after 5 s delay
  setTimeout(() => {
    runDataSync().catch((err) => logger.error({ err }, "Initial calendar sync failed"));
  }, 5_000);

  // Release detection: every 30 s (uses in-memory cache — no API calls)
  detectionTask = cron.schedule("*/30 * * * * *", async () => {
    await pollCycle();
  });

  // Normal data sync: every 30 minutes
  normalSyncTask = cron.schedule("*/30 * * * *", async () => {
    if (!isHighImpactMode) await runDataSync();
  });

  // Firestore cleanup: every hour
  cleanupTask = cron.schedule("0 * * * *", cleanupExpiredData);

  logger.info(
    "Scheduler started: 30s release-detection, 30min normal sync, 5min high-impact sync, hourly cleanup",
  );
}

export function stopScheduler(): void {
  detectionTask?.stop();
  normalSyncTask?.stop();
  highImpactTask?.stop();
  cleanupTask?.stop();
  detectionTask  = null;
  normalSyncTask = null;
  highImpactTask = null;
  cleanupTask    = null;
  isHighImpactMode = false;
  setHighImpactMode(false);
  logger.info("Scheduler stopped");
}

export function getSchedulerStatus(): Record<string, unknown> {
  return {
    detectionTaskRunning:   detectionTask !== null,
    normalSyncTaskRunning:  normalSyncTask !== null,
    highImpactMode:         isHighImpactMode,
    highImpactTaskRunning:  highImpactTask !== null,
    cleanupTaskRunning:     cleanupTask !== null,
  };
}
