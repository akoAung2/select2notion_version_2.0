/**
 * Event Engine — Parallel pipeline for processing economic events
 * Parallelizes: news fetch + rule engine → AI → Telegram + Firestore (concurrent)
 */

import { logger } from "../lib/logger.js";
import { normalizeEventName } from "./normalization.js";
import { applyRules } from "./ruleEngine.js";
import { findEventGroup } from "./eventGroup.js";
import { generateFundamentalAnalysis, saveAIReport } from "../ai/geminiService.js";
import { getNewsForEvent, type NewsArticle } from "../news/api/newsApiClient.js";
import { getMacroSnapshot } from "../news/api/fredClient.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";
import { broadcastTelegramMessage, logTelegramAlert } from "./telegramBroadcast.js";
import type { CalendarEvent } from "../news/parser/calendarParser.js";
import { isRedisReady } from "../lib/redis.js";
import { enqueueAIJob, isEventProcessed } from "../lib/queue.js";

export async function processReleasedEvent(event: CalendarEvent): Promise<void> {
  const startTime = Date.now();
  logger.info({ event: event.name, actual: event.actual }, "Processing released event (parallel pipeline)");

  // ── DEDUP CHECK — skip if already processed in Redis (within 72h) ──────────
  if (isRedisReady() && await isEventProcessed(event.id)) {
    logger.info({ event: event.name }, "Event already processed — skipping (Redis dedup)");
    return;
  }

  const canonicalId = normalizeEventName(event.name);
  const group = findEventGroup(canonicalId);

  // ── PARALLEL PHASE 1: rule engine + news fetch + FRED macro snapshot simultaneously ──
  const noNews: NewsArticle[] = [];
  const [ruleResult, newsArticles, fredSnapshot] = await Promise.all([
    Promise.resolve(applyRules(event.name, event.actual, event.forecast, event.previous)),
    getNewsForEvent(event.name).catch(() => noNews),
    getMacroSnapshot().catch(() => ({})),
  ]);

  const relatedNews = newsArticles.slice(0, 3).map((a) => a.title);

  // Format FRED macro data as historicalContext for the AI prompt.
  // Logs a warning when FRED is unavailable so missing context is observable during incidents.
  const fredKeys = Object.keys(fredSnapshot);
  if (fredKeys.length === 0) {
    logger.warn({ event: event.name }, "FRED macro snapshot unavailable — AI prompt will lack historical context");
  }
  const historicalContext = fredKeys.length > 0
    ? Object.entries(fredSnapshot)
        .map(([id, d]) => `${d.name} (${id}): ${d.value} [${d.date}]`)
        .join("\n")
    : undefined;

  const analysisInput = {
    eventName: event.name,
    actual: event.actual,
    forecast: event.forecast,
    previous: event.previous,
    ruleResult,
    groupName: group?.name,
    relatedNews,
    historicalContext,
  };

  // ── REDIS QUEUE PATH ───────────────────────────────────────────────────
  // When Redis is available, enqueue this job for the worker pool.
  // The worker handles per-user AI generation + Telegram delivery with dedup.
  // Firestore event save still runs inline (it's fast and idempotent).
  if (isRedisReady()) {
    const previewMsg = buildReleaseMessage(event, ruleResult, "");
    const result = await enqueueAIJob({
      eventId: event.id,
      eventName: event.name,
      analysisInput,
      usdBias: ruleResult.usdBias,
      riskSentiment: ruleResult.riskSentiment,
      telegramMessage: previewMsg,
      impact: event.impact,
      currency: event.currency,
    });

    if (result === "queued") {
      // Save the event metadata to Firestore immediately (doesn't need AI result)
      await saveEventToFirestore(event, ruleResult);
      const elapsed = Date.now() - startTime;
      logger.info({ event: event.name, elapsedMs: elapsed }, "Event queued to Redis — worker will handle AI + Telegram");
      return;
    }
    // "duplicate" or "fallback" → fall through to inline processing below
    if (result === "duplicate") {
      logger.info({ event: event.name }, "Event already queued — skipping duplicate");
      return;
    }
    logger.warn({ event: event.name }, "Redis fallback — processing inline");
  }

  // ── INLINE PATH (Redis unavailable or queue at capacity) ───────────────
  const analysis = await generateFundamentalAnalysis(analysisInput);

  const report = {
    eventId: event.id,
    eventName: event.name,
    analysis,
    generatedAt: new Date().toISOString(),
    usdBias: ruleResult.usdBias,
    riskSentiment: ruleResult.riskSentiment,
    affectedAssets: ruleResult.affectedAssets,
  };

  // ── PARALLEL PHASE 2: Firestore save + Telegram send simultaneously ────
  const telegramMsg = buildReleaseMessage(event, ruleResult, analysis);

  await Promise.allSettled([
    saveAIReport(report),
    saveEventToFirestore(event, ruleResult),
    broadcastTelegramMessage(telegramMsg, { impact: event.impact, currency: event.currency }).then(() =>
      logTelegramAlert("release", event.name, telegramMsg),
    ),
  ]);

  const elapsed = Date.now() - startTime;
  logger.info({ event: event.name, elapsedMs: elapsed }, "Event processing complete (inline path)");
}

function buildReleaseMessage(
  event: CalendarEvent,
  ruleResult: ReturnType<typeof applyRules>,
  analysis: string,
): string {
  const biasEmoji =
    ruleResult.usdBias === "bullish" ? "🟢" : ruleResult.usdBias === "bearish" ? "🔴" : "⚪";
  const beat =
    event.actual && event.forecast &&
    !isNaN(Number(event.actual.replace(/[^0-9.-]/g, ""))) &&
    Number(event.actual.replace(/[^0-9.-]/g, "")) >
      Number(event.forecast.replace(/[^0-9.-]/g, ""));
  const resultLabel = event.actual && event.forecast ? (beat ? "✅ BEAT" : "❌ MISS") : "";

  return `${biasEmoji} *${event.name} Released* ${resultLabel}

📊 Actual: *${event.actual ?? "N/A"}*
📈 Forecast: ${event.forecast ?? "N/A"}
📉 Previous: ${event.previous ?? "N/A"}
${biasEmoji} USD: *${ruleResult.usdBias.toUpperCase()}*

${analysis}`;
}

async function saveEventToFirestore(
  event: CalendarEvent,
  ruleResult: ReturnType<typeof applyRules>,
): Promise<void> {
  if (!isAdminReady()) return;
  const db = getAdminDb();
  const payload = {
    ...event,
    usdBias:        ruleResult.usdBias,
    usdStrength:    ruleResult.usdStrength,
    riskSentiment:  ruleResult.riskSentiment,
    affectedAssets: ruleResult.affectedAssets,
    processedAt:    new Date(),
    // Expire released events after 72 hours so the collection self-cleans
    expiresAt: new Date(Date.now() + 72 * 3600_000),
  };
  try {
    // AI-processed released events belong in released_events (authoritative).
    // Also remove the upcoming stub from economic_events so no stale doc lingers.
    const batch = db.batch();
    batch.set(db.collection("released_events").doc(event.id), payload, { merge: true });
    batch.delete(db.collection("economic_events").doc(event.id));
    await batch.commit();
  } catch (err) {
    logger.error({ err, eventId: event.id }, "Failed to save event");
  }
}

/**
 * saveCalendarSnapshot — writes events into two separate collections:
 *
 *  • economic_events  — upcoming (not yet released) events, TTL 7 days
 *  • released_events  — events with actual values,       TTL 72 hours
 *
 * This separation keeps the upcoming calendar clean and prevents released
 * data from aging out too slowly or too quickly relative to its usefulness.
 */
export async function saveCalendarSnapshot(events: CalendarEvent[]): Promise<void> {
  if (!isAdminReady() || events.length === 0) return;
  try {
    const db = getAdminDb();
    const upcoming  = events.filter((e) => !e.hasActual && !e.isReleased);
    const released  = events.filter((e) => e.hasActual || e.isReleased);

    const upcomingExpiresAt = new Date(Date.now() + 7 * 24 * 3600_000);  // 7 days
    const releasedExpiresAt = new Date(Date.now() + 72 * 3600_000);       // 72 hours

    // Write in batches of 500 (Firestore limit)
    const writeBatch = <T extends { id: string }>(
      items: T[], collection: string, expiresAt: Date,
    ) => {
      const batches: Promise<void>[] = [];
      for (let i = 0; i < items.length; i += 500) {
        const b = db.batch();
        items.slice(i, i + 500).forEach((e) => {
          b.set(db.collection(collection).doc(e.id),
            { ...e, updatedAt: new Date(), expiresAt }, { merge: true });
        });
        batches.push(b.commit().then(() => undefined));
      }
      return Promise.all(batches);
    };

    // Write upcoming to economic_events, released to released_events
    const writes = [
      upcoming.length > 0 ? writeBatch(upcoming, "economic_events", upcomingExpiresAt) : Promise.resolve([]),
      released.length > 0 ? writeBatch(released, "released_events", releasedExpiresAt) : Promise.resolve([]),
    ];

    // When events transition from upcoming → released, remove their stale docs from
    // economic_events so that collection stays strictly upcoming-only.
    const removeTransitioned = async () => {
      if (released.length === 0) return;
      // Batch-delete any released-event IDs that still exist in economic_events
      for (let i = 0; i < released.length; i += 500) {
        const slice = released.slice(i, i + 500);
        const b = db.batch();
        slice.forEach((e) => b.delete(db.collection("economic_events").doc(e.id)));
        await b.commit().catch(() => { /* ignore — doc may not exist */ });
      }
    };

    await Promise.all([...writes, removeTransitioned()]);

    logger.info({ upcoming: upcoming.length, released: released.length }, "Calendar snapshot saved");
  } catch (err) {
    logger.error({ err }, "Failed to save calendar snapshot");
  }
}

/**
 * getEventsFromFirestore — reads from both collections and merges:
 *  • economic_events  — upcoming events (time >= today)
 *  • released_events  — recently released (within past 72 h)
 */
export async function getEventsFromFirestore(limit = 100): Promise<CalendarEvent[]> {
  if (!isAdminReady()) return [];
  try {
    const db = getAdminDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cutoff72h = new Date(Date.now() - 72 * 3600_000);

    const [upcomingSnap, releasedSnap] = await Promise.all([
      db.collection("economic_events")
        .where("time", ">=", today.toISOString())
        .orderBy("time", "asc")
        .limit(limit)
        .get(),
      db.collection("released_events")
        .where("time", ">=", cutoff72h.toISOString())
        .orderBy("time", "desc")
        .limit(50)
        .get().catch(() => null), // released_events may not exist yet — safe fallback
    ]);

    const upcoming = upcomingSnap.docs.map((d) => d.data() as CalendarEvent);
    const released = releasedSnap?.docs.map((d) => d.data() as CalendarEvent) ?? [];

    // Merge, dedup by id, sort by time
    const byId = new Map<string, CalendarEvent>();
    for (const e of [...upcoming, ...released]) byId.set(e.id, e);
    const merged = Array.from(byId.values())
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return merged;
  } catch (err) {
    logger.error({ err }, "Failed to load events from Firestore");
    return [];
  }
}
