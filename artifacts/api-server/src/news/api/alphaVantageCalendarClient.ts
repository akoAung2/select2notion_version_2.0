/**
 * Alpha Vantage Economic Calendar Client
 * Uses AV's economic indicator series to produce CalendarEvent data:
 *   • Released events (with actual values from latest series data)
 *   • Upcoming event stubs (estimated next release dates)
 *
 * Free-tier rate limit: 25 req/day → aggressive 8-hour cache (≤3 syncs/day = 15 calls)
 */

import { logger } from "../../lib/logger.js";
import type { CalendarEvent } from "../parser/calendarParser.js";

const AV_BASE = "https://www.alphavantage.co/query";
const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";

let avCache: CalendarEvent[] | null = null;
let avCacheTime = 0;
const AV_CACHE_TTL       = 8 * 60 * 60_000; // 8 hours
const AV_RATELIMIT_DELAY = 1 * 60 * 60_000; // 1 hour cooldown on rate-limit
let avRateLimitUntil = 0;                    // epoch ms — 0 means not throttled

interface AvSeriesResponse {
  name?: string;
  interval?: string;
  unit?: string;
  data?: Array<{ date: string; value: string }>;
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

interface AvIndicator {
  fn: string;
  name: string;
  currency: "USD";
  impact: "high" | "medium" | "low";
  interval: "monthly" | "quarterly" | "annual";
  /** Approximate release day-of-month for monthly indicators */
  releaseDay?: number;
  /** Whether this follows the "first Friday" NFP schedule */
  firstFriday?: boolean;
}

const INDICATORS: AvIndicator[] = [
  { fn: "CPI",                 name: "Consumer Price Index",   currency: "USD", impact: "high",   interval: "monthly",   releaseDay: 12 },
  { fn: "NONFARM_PAYROLL",     name: "Non Farm Payrolls",      currency: "USD", impact: "high",   interval: "monthly",   firstFriday: true },
  { fn: "UNEMPLOYMENT",        name: "Unemployment Rate",      currency: "USD", impact: "high",   interval: "monthly",   firstFriday: true },
  { fn: "FEDERAL_FUNDS_RATE",  name: "Fed Funds Rate",         currency: "USD", impact: "high",   interval: "monthly",   releaseDay: 1 },
  { fn: "REAL_GDP",            name: "GDP Growth Rate",        currency: "USD", impact: "high",   interval: "quarterly", releaseDay: 28 },
];

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Find the next first-Friday AFTER today (not after lastDate).
 * lastDate is used as a hint for which month to start from, but we always
 * advance forward until the result is strictly in the future.
 */
function nextFirstFriday(lastDate: string): string {
  const now = Date.now();
  // Start from the month AFTER lastDate, or the current month — whichever is later
  const base = new Date(Math.max(new Date(lastDate).getTime(), now));
  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  // Find first Friday of the candidate month
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(12, 30, 0, 0);
  // If that Friday is already past or today, advance to next month
  while (d.getTime() <= now) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(12, 30, 0, 0);
  }
  return d.toISOString();
}

/**
 * Find the next scheduled monthly/quarterly release strictly after now.
 * Uses releaseDay for monthly, +90d for quarterly, advancing until future.
 */
function nextScheduledRelease(lastDate: string, ind: AvIndicator): string {
  const now = Date.now();
  const base = new Date(Math.max(new Date(lastDate).getTime(), now));
  if (ind.interval === "quarterly") {
    // Advance by 90-day increments until strictly after now
    let d = new Date(base.getTime() + 90 * 86_400_000);
    d.setUTCHours(12, 30, 0, 0);
    while (d.getTime() <= now) d = new Date(d.getTime() + 90 * 86_400_000);
    return d.toISOString();
  }
  const day = ind.releaseDay ?? 10;
  // Try current month's release day, advance month until strictly after now
  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day, 12, 30, 0, 0));
  while (d.getTime() <= now) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day, 12, 30, 0, 0));
  }
  return d.toISOString();
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchAvSeries(ind: AvIndicator): Promise<AvSeriesResponse | null> {
  const url = new URL(AV_BASE);
  url.searchParams.set("function", ind.fn);
  if (ind.interval !== "monthly") url.searchParams.set("interval", ind.interval);
  url.searchParams.set("apikey", AV_KEY);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      logger.warn({ status: resp.status, fn: ind.fn }, "Alpha Vantage series HTTP error");
      return null;
    }
    const data = await resp.json() as AvSeriesResponse;
    if (data["Error Message"] || data.Note || data.Information) {
      // Mark rate-limit so the caller can impose a cooldown
      avRateLimitUntil = Date.now() + AV_RATELIMIT_DELAY;
      logger.warn({ msg: data["Error Message"] ?? data.Note ?? data.Information, fn: ind.fn,
        cooldownUntil: new Date(avRateLimitUntil).toISOString() },
        "Alpha Vantage rate-limit or plan error — cooldown activated");
      return null;
    }
    return data;
  } catch (err) {
    logger.error({ err, fn: ind.fn }, "Alpha Vantage fetch error");
    return null;
  }
}

function makeId(name: string, date: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return `${date.slice(0, 10)}_${slug}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getAlphaVantageCalendar(): Promise<CalendarEvent[]> {
  if (!AV_KEY) {
    logger.warn("ALPHA_VANTAGE_API_KEY not set — skipping AV calendar provider");
    return [];
  }

  const now = Date.now();

  // Respect rate-limit cooldown — return EMPTY so the service falls through to FRED.
  // The pollingEngine's own in-memory cache handles stale-serving at a higher level.
  if (avRateLimitUntil > now) {
    const waitMin = Math.ceil((avRateLimitUntil - now) / 60_000);
    logger.warn({ waitMin }, "Alpha Vantage rate-limit cooldown active — skipping provider (FRED next)");
    return [];
  }

  if (avCache && now - avCacheTime < AV_CACHE_TTL) {
    logger.info({ count: avCache.length }, "Alpha Vantage calendar (from cache)");
    return avCache;
  }

  logger.info({ indicators: INDICATORS.length }, "Alpha Vantage calendar request — fetching economic indicators");

  // Fetch all indicators in parallel — 5 calls, well within 25/day limit at 8h cache
  const results = await Promise.allSettled(
    INDICATORS.map(async (ind) => ({ ind, data: await fetchAvSeries(ind) })),
  );

  const events: CalendarEvent[] = [];
  let fetched = 0;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { ind, data } = result.value;
    if (!data?.data?.length) continue;

    const series = data.data.filter((d) => d.value && d.value !== ".");
    if (!series.length) continue;
    fetched++;

    const latest = series[0];
    const previous = series[1]?.value ?? null;

    // ── Released event (has actual value) ─────────────────────────────────
    const relTime = new Date(`${latest.date}T12:30:00Z`).toISOString();
    events.push({
      id: makeId(ind.name, relTime),
      canonicalId: ind.fn.toLowerCase(),
      name: ind.name,
      currency: ind.currency,
      country: "US",
      category: "macro",
      impact: ind.impact,
      time: relTime,
      actual: latest.value,
      forecast: null,
      previous,
      source: "alpha_vantage",
      hasActual: true,
      isReleased: true,
    });

    // ── Upcoming stub (estimated next release date) ────────────────────────
    const nextTime = ind.firstFriday
      ? nextFirstFriday(latest.date)
      : nextScheduledRelease(latest.date, ind);

    if (new Date(nextTime).getTime() > now) {
      events.push({
        id: makeId(`${ind.name}_upcoming`, nextTime),
        canonicalId: `${ind.fn.toLowerCase()}_upcoming`,
        name: ind.name,
        currency: ind.currency,
        country: "US",
        category: "macro",
        impact: ind.impact,
        time: nextTime,
        actual: null,
        forecast: null,
        previous: latest.value,
        source: "alpha_vantage",
        hasActual: false,
        isReleased: false,
      });
    }
  }

  const upcoming = events.filter((e) => !e.isReleased).length;
  logger.info({ total: events.length, upcoming, indicators: fetched }, "Alpha Vantage calendar response");

  if (events.length > 0) {
    avCache = events;
    avCacheTime = now;
  }

  return events;
}

export function invalidateAvCalendarCache(): void {
  avCacheTime = 0;
  logger.info("Alpha Vantage calendar cache invalidated");
}
