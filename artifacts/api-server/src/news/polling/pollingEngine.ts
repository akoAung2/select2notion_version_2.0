/**
 * Polling Engine
 * Fetches calendar data via the multi-provider service, detects releases,
 * and triggers the event pipeline (AI + Telegram + Firestore).
 *
 * Two separate concerns:
 *  • Data sync  — calls external providers; cache TTL 30 min (normal) / 5 min (high-impact)
 *  • Release detection — checks in-memory cache every 30 s; no API calls
 */

import { logger } from "../../lib/logger.js";
import { mergeAndDedup, getRecentlyReleased, type CalendarEvent } from "../parser/calendarParser.js";
import { fetchEconomicEvents } from "../service/economicCalendarService.js";
import { saveCalendarSnapshot, processReleasedEvent } from "../../engine/eventEngine.js";
import { broadcastTelegramMessage, logTelegramAlert } from "../../engine/telegramBroadcast.js";
import { generateWarningMessage } from "../../ai/geminiService.js";

// ── Cache TTLs ────────────────────────────────────────────────────────────────
const NORMAL_CACHE_TTL      = 30 * 60_000; //  30 minutes  (normal mode)
const HIGH_IMPACT_CACHE_TTL =  5 * 60_000; //   5 minutes  (high-impact mode)

// ── In-memory state ───────────────────────────────────────────────────────────
let lastSnapshot: Map<string, CalendarEvent> = new Map();
let processedEventIds: Set<string> = new Set();
let scheduledWarnings: Map<string, NodeJS.Timeout[]> = new Map();
let cachedCalendar: CalendarEvent[] = [];
let lastFetchTime = 0;
let highImpactMode = false;

/** Mutex: prevents concurrent pollCycle runs (30s cron + 30min sync can overlap). */
let isSyncing = false;

export function getCachedCalendar(): CalendarEvent[] { return cachedCalendar; }
export function setHighImpactMode(enabled: boolean): void { highImpactMode = enabled; }

// ── Data sync ─────────────────────────────────────────────────────────────────

export async function fetchAllCalendarData(): Promise<CalendarEvent[]> {
  const now = Date.now();
  const ttl = highImpactMode ? HIGH_IMPACT_CACHE_TTL : NORMAL_CACHE_TTL;

  // Serve from in-memory cache if still fresh
  if (now - lastFetchTime < ttl && cachedCalendar.length > 0) {
    return cachedCalendar;
  }

  // Delegate to multi-provider service (FMP → AV → FRED → Firestore)
  const { events, provider, fromFallback } = await fetchEconomicEvents();

  if (events.length === 0 && cachedCalendar.length > 0) {
    // All providers returned nothing — keep stale in-memory cache with refreshed flags
    const cacheAgeMinutes = Math.round((now - lastFetchTime) / 60_000);
    cachedCalendar = cachedCalendar.map((e) => ({
      ...e,
      isReleased: !!e.actual || new Date(e.time).getTime() < now,
      hasActual:  !!e.actual,
    }));
    lastFetchTime = now - ttl + 30_000; // retry in 30 s
    logger.warn({ staleCount: cachedCalendar.length, cacheAgeMinutes },
      "All providers returned 0 events — serving stale in-memory calendar");
    return cachedCalendar;
  }

  // Fresh data from service — recompute released flags and merge with cache
  const refreshed = events.map((e) => ({
    ...e,
    isReleased: !!e.actual || new Date(e.time).getTime() < now,
    hasActual:  !!e.actual,
  }));

  const merged = mergeAndDedup(refreshed);
  const upcoming = merged.filter((e) => !e.isReleased).length;

  logger.info({ total: merged.length, upcoming, provider, fromFallback }, "Calendar fetch complete");

  cachedCalendar = merged;
  lastFetchTime  = now;
  return merged;
}

// ── Release detection + Telegram warnings ──────────────────────────────────────
// Called every 30 s; uses in-memory cache — no external API calls.

export async function pollCycle(): Promise<void> {
  // Guard: skip if a cycle is already in progress (30s cron + 30min sync can overlap)
  if (isSyncing) {
    logger.debug("pollCycle skipped — already running");
    return;
  }
  isSyncing = true;
  try {
    const events = await fetchAllCalendarData();
    await saveCalendarSnapshot(events);

    // Detect newly released events (has actual value, not yet processed)
    const released = getRecentlyReleased(events, 60);
    for (const event of released) {
      if (!processedEventIds.has(event.id) && event.hasActual) {
        logger.info({ event: event.name, actual: event.actual }, "New released event detected — processing");
        processedEventIds.add(event.id);
        processReleasedEvent(event).catch((err) =>
          logger.error({ err, event: event.name }, "Event processing failed"),
        );
      }
    }

    // Diff vs last snapshot — detect new events and schedule pre-event warnings
    const newMap = new Map(events.map((e) => [e.id, e]));
    for (const [id, event] of newMap) {
      const prev = lastSnapshot.get(id);
      if (!prev) {
        logger.info({ event: event.name, impact: event.impact, source: event.source },
          "New calendar event detected");
        if (event.impact === "high" && !event.isReleased) {
          scheduleWarnings(event);
        }
      } else if (!prev.hasActual && event.hasActual && !processedEventIds.has(id)) {
        logger.info({ event: event.name, actual: event.actual }, "Event actual data arrived");
      }
    }

    lastSnapshot = newMap;
  } catch (err) {
    logger.error({ err }, "Poll cycle error");
  } finally {
    isSyncing = false;
  }
}

// ── Pre-event Telegram warnings ───────────────────────────────────────────────

const WARNING_MINUTES = [60, 30, 15, 5, 1] as const;

function scheduleWarnings(event: CalendarEvent): void {
  if (scheduledWarnings.has(event.id)) return;

  const eventTime = new Date(event.time).getTime();
  const now       = Date.now();
  const timers: NodeJS.Timeout[] = [];

  for (const mins of WARNING_MINUTES) {
    const delay = (eventTime - mins * 60_000) - now;
    if (delay <= 0) continue;

    const t = setTimeout(async () => {
      logger.info({ event: event.name, mins }, "Sending pre-event warning");
      try {
        const msg = await generateWarningMessage(event.name, mins, event.forecast, event.previous);
        await broadcastTelegramMessage(msg, {
          alertType: "warning",
          minutesBefore: mins,
          impact: event.impact,
        });
        await logTelegramAlert("warning", event.name, msg);
      } catch (err) {
        logger.error({ err, event: event.name, mins }, "Warning send error");
      }
    }, delay);

    timers.push(t);
  }

  if (timers.length > 0) {
    scheduledWarnings.set(event.id, timers);
    logger.info(
      { event: event.name, scheduled: WARNING_MINUTES.filter((m) => (eventTime - m * 60_000) > now) },
      "Warnings scheduled",
    );
  }
}

export function clearWarnings(eventId: string): void {
  const timers = scheduledWarnings.get(eventId);
  if (timers) { timers.forEach(clearTimeout); scheduledWarnings.delete(eventId); }
}

export function getPollingStats(): Record<string, unknown> {
  return {
    cachedEventCount:       cachedCalendar.length,
    lastFetchTime:          lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
    cacheTtlMs:             highImpactMode ? HIGH_IMPACT_CACHE_TTL : NORMAL_CACHE_TTL,
    highImpactMode,
    processedEventCount:    processedEventIds.size,
    scheduledWarningCount:  scheduledWarnings.size,
    snapshotSize:           lastSnapshot.size,
  };
}

/** Force a full refresh (bypass cache) on next poll */
export function invalidateCache(): void {
  lastFetchTime = 0;
  logger.info("Calendar cache invalidated — next poll will fetch from providers");
}
