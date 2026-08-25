/**
 * Financial Modeling Prep API Client — v4 Stable
 * Rate limit: FMP free tier ~5 req/min → use 15-min cache + 429 backoff
 */

import { logger } from "../../lib/logger.js";

const BASE = "https://financialmodelingprep.com/stable";
const API_KEY = process.env.FMP_API_KEY ?? "";

// Cache to avoid 429 rate limiting — 15 minutes between fetches
let todayCache: NormalizedFmpEvent[] | null = null;
let todayCacheTime = 0;
let weekCache: NormalizedFmpEvent[] | null = null;
let weekCacheTime = 0;
let rateLimitedUntil = 0; // Back-off timestamp
const CACHE_TTL = 15 * 60_000; // 15 min

export interface FmpCalendarEvent {
  event: string;
  date: string;
  country: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  impact: string;
  unit?: string;
}

export interface NormalizedFmpEvent {
  event: string;
  date: string;
  country: string;
  currency: string;
  previous: string | null;
  estimate: string | null;
  actual: string | null;
  impact: string;
}

function toStringOrNull(val: number | null): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

async function fmpFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!API_KEY) {
    logger.warn("FMP_API_KEY not set");
    return null;
  }

  // Rate limit back-off: if we recently got a 429, wait
  if (Date.now() < rateLimitedUntil) {
    logger.warn({ retryAfter: Math.round((rateLimitedUntil - Date.now()) / 1000) }, "FMP rate limit back-off active");
    return null;
  }

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apikey", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);

    if (resp.status === 429) {
      // Back off for 5 minutes on rate limit
      rateLimitedUntil = Date.now() + 5 * 60_000;
      logger.warn({ path, backoffUntil: new Date(rateLimitedUntil).toISOString() }, "FMP rate limited — backing off 5 min");
      return null;
    }

    if (resp.status === 402) {
      // HTTP 402 = plan does not include this endpoint — back off 24h to stop wasting calls
      rateLimitedUntil = Date.now() + 24 * 60 * 60_000;
      logger.error({ path, backoffUntil: new Date(rateLimitedUntil).toISOString() },
        "FMP plan limit (HTTP 402) — 24h backoff applied. Upgrade plan at financialmodelingprep.com to restore live calendar.");
      return null;
    }

    if (!resp.ok) {
      logger.warn({ status: resp.status, path }, "FMP API error");
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    logger.error({ err, path }, "FMP fetch error");
    return null;
  }
}

async function getEconomicCalendar(from: string, to: string): Promise<NormalizedFmpEvent[]> {
  const data = await fmpFetch<FmpCalendarEvent[] | Record<string, string>>("/economic-calendar", { from, to });
  // FMP plan-limit returns HTTP 200 with {"Error Message":"Limit Reach..."} instead of a 429.
  // Detect this and apply a 24-hour backoff so we stop hammering a plan-limited key.
  if (data && !Array.isArray(data) && (data as Record<string, string>)["Error Message"]) {
    const msg = (data as Record<string, string>)["Error Message"];
    rateLimitedUntil = Date.now() + 24 * 60 * 60_000; // 24h backoff
    logger.error({ msg, backoffUntil: new Date(rateLimitedUntil).toISOString() },
      "FMP plan limit reached — applying 24h backoff. Upgrade FMP plan or rotate key.");
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((e) => e.currency === "USD" || e.country === "US" || e.country === "United States")
    .map((e) => ({
      event: e.event,
      date: e.date,
      country: e.country,
      currency: e.currency || "USD",
      previous: toStringOrNull(e.previous),
      estimate: toStringOrNull(e.estimate),
      actual: toStringOrNull(e.actual),
      impact: e.impact,
    }));
}

export async function getTodayCalendar(): Promise<NormalizedFmpEvent[]> {
  const now = Date.now();
  if (todayCache && now - todayCacheTime < CACHE_TTL) {
    return todayCache;
  }
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(now + 86_400_000).toISOString().split("T")[0];
  const result = await getEconomicCalendar(today, tomorrow);
  if (result.length > 0 || (now - todayCacheTime > CACHE_TTL * 2)) {
    todayCache = result;
    todayCacheTime = now;
  }
  return result;
}

export async function getWeekCalendar(): Promise<NormalizedFmpEvent[]> {
  const now = Date.now();
  if (weekCache && now - weekCacheTime < CACHE_TTL) {
    return weekCache;
  }
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date(now + 7 * 86_400_000).toISOString().split("T")[0];
  const result = await getEconomicCalendar(today, nextWeek);
  if (result.length > 0 || (now - weekCacheTime > CACHE_TTL * 2)) {
    weekCache = result;
    weekCacheTime = now;
  }
  return result;
}

export function invalidateFmpCache(): void {
  todayCacheTime = 0;
  weekCacheTime = 0;
}
