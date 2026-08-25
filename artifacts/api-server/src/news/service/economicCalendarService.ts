/**
 * Economic Calendar Service — Multi-Provider Fallback
 *
 * Priority cascade (never returns empty if any provider or cache has data):
 *   1. FMP  (primary — structured exchange calendar)
 *   2. Alpha Vantage  (fallback 1 — economic indicator series)
 *   3. FRED  (fallback 2 — official US release schedule)
 *   4. Firestore cache  (fallback 3 — last known good data)
 *
 * Each provider is tried with up to 3 attempts and exponential back-off (1 → 2 → 4 s).
 * Failures are logged to the `calendar_errors` Firestore collection.
 */

import { logger } from "../../lib/logger.js";
import { getTodayCalendar, getWeekCalendar } from "../api/fmpClient.js";
import { parseFmpEvent, mergeAndDedup, type CalendarEvent } from "../parser/calendarParser.js";
import { getAlphaVantageCalendar } from "../api/alphaVantageCalendarClient.js";
import { getFredCalendarEvents } from "../api/fredClient.js";
import { getEventsFromFirestore } from "../../engine/eventEngine.js";
import { getAdminDb, isAdminReady } from "../../lib/firebaseAdmin.js";

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
  providerName = "unknown",
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      logger.warn({ provider: providerName, attempt, maxAttempts, err: String(err) },
        isLast ? "Provider failed — all retries exhausted" : "Provider attempt failed — retrying");

      if (isLast) {
        await logCalendarError(providerName, err);
        return null;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
}

// ── Error logging (non-blocking) ──────────────────────────────────────────────

async function logCalendarError(provider: string, error: unknown): Promise<void> {
  if (!isAdminReady()) return;
  try {
    await getAdminDb().collection("calendar_errors").add({
      provider,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), // 7-day TTL
    });
  } catch { /* never let logging break the pipeline */ }
}

// ── Provider fetch functions ──────────────────────────────────────────────────

async function fetchFromFmp(): Promise<CalendarEvent[]> {
  const [today, week] = await Promise.all([getTodayCalendar(), getWeekCalendar()]);
  const merged = mergeAndDedup([
    ...today.map(parseFmpEvent),
    ...week.map(parseFmpEvent),
  ]);
  return merged;
}

async function fetchFromAlphaVantage(): Promise<CalendarEvent[]> {
  return getAlphaVantageCalendar();
}

async function fetchFromFred(): Promise<CalendarEvent[]> {
  return getFredCalendarEvents();
}

async function fetchFromFirestoreCache(): Promise<CalendarEvent[]> {
  return getEventsFromFirestore(100);
}

// ── Public service API ────────────────────────────────────────────────────────

export interface CalendarFetchResult {
  events: CalendarEvent[];
  provider: string;
  fromFallback: boolean;
}

export async function fetchEconomicEvents(): Promise<CalendarFetchResult> {

  // ── Step 1: FMP ─────────────────────────────────────────────────────────
  logger.info({ provider: "FMP" }, "Provider selected: FMP");
  try {
    const fmpEvents = await withRetry(fetchFromFmp, 3, 1000, "fmp");
    if (fmpEvents && fmpEvents.length > 0) {
      const upcoming = fmpEvents.filter((e) => !e.isReleased).length;
      logger.info({ count: fmpEvents.length, upcoming, provider: "fmp" }, "Events fetched — provider: FMP");
      return { events: fmpEvents, provider: "fmp", fromFallback: false };
    }
    logger.warn("FMP returned 0 events — activating fallback");
    await logCalendarError("fmp", new Error("FMP returned 0 events (plan limit or no data)"));
  } catch (err) {
    logger.error({ err }, "FMP provider threw unexpectedly");
    await logCalendarError("fmp", err);
  }

  // ── Step 2: Alpha Vantage ────────────────────────────────────────────────
  logger.info({ provider: "Alpha Vantage" }, "Fallback activated — provider selected: Alpha Vantage");
  try {
    const avEvents = await withRetry(fetchFromAlphaVantage, 3, 1000, "alpha_vantage");
    if (avEvents && avEvents.length > 0) {
      const upcoming = avEvents.filter((e) => !e.isReleased).length;
      logger.info({ count: avEvents.length, upcoming, provider: "alpha_vantage" }, "Events fetched — provider: Alpha Vantage");
      return { events: avEvents, provider: "alpha_vantage", fromFallback: true };
    }
    logger.warn("Alpha Vantage returned 0 events — activating next fallback");
    await logCalendarError("alpha_vantage", new Error("Alpha Vantage returned 0 events"));
  } catch (err) {
    logger.error({ err }, "Alpha Vantage provider threw unexpectedly");
    await logCalendarError("alpha_vantage", err);
  }

  // ── Step 3: FRED release calendar ────────────────────────────────────────
  logger.info({ provider: "FRED" }, "Fallback activated — provider selected: FRED");
  try {
    const fredEvents = await withRetry(fetchFromFred, 3, 1000, "fred");
    if (fredEvents && fredEvents.length > 0) {
      const upcoming = fredEvents.filter((e) => !e.isReleased).length;
      logger.info({ count: fredEvents.length, upcoming, provider: "fred" }, "Events fetched — provider: FRED");
      return { events: fredEvents, provider: "fred", fromFallback: true };
    }
    logger.warn("FRED returned 0 events — falling back to Firestore cache");
    await logCalendarError("fred", new Error("FRED returned 0 events"));
  } catch (err) {
    logger.error({ err }, "FRED provider threw unexpectedly");
    await logCalendarError("fred", err);
  }

  // ── Step 4: Firestore cache ───────────────────────────────────────────────
  logger.info({ provider: "Firestore cache" }, "Fallback activated — provider selected: Firestore cache");
  try {
    const stored = await fetchFromFirestoreCache();
    const cacheAge = stored.length > 0 ? "present" : "empty";
    logger.info({ count: stored.length, cacheAge }, "Events fetched — provider: Firestore cache");
    return { events: stored, provider: "firestore_cache", fromFallback: true };
  } catch (err) {
    logger.error({ err }, "Firestore cache fallback failed");
    await logCalendarError("firestore_cache", err);
    return { events: [], provider: "none", fromFallback: true };
  }
}
