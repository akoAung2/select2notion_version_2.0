/**
 * FRED API Client (Federal Reserve Economic Data)
 * St. Louis Fed — reliable US macro data
 */

import { logger } from "../../lib/logger.js";

const BASE = "https://api.stlouisfed.org/fred";
const API_KEY = process.env.FRED_API_KEY ?? "";

export interface FredObservation {
  date: string;
  value: string;
}

async function fredFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!API_KEY) {
    logger.warn("FRED_API_KEY not set");
    return null;
  }
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("file_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ status: resp.status, path, body: text.slice(0, 200) }, "FRED API error");
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      logger.warn({ path }, "FRED API timeout");
    } else {
      logger.error({ err, path }, "FRED fetch error");
    }
    return null;
  }
}

const KEY_SERIES: Record<string, string> = {
  UNRATE: "Unemployment Rate (%)",
  CPIAUCSL: "CPI YoY",
  CPILFESL: "Core CPI",
  PCEPI: "PCE Inflation",
  PAYEMS: "Nonfarm Payrolls",
  FEDFUNDS: "Fed Funds Rate (%)",
  T10YIE: "10Y Breakeven",
  DFF: "Effective FF Rate",
};

export async function getLatestObservation(seriesId: string): Promise<FredObservation | null> {
  const thirtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().split("T")[0];
  const data = await fredFetch<{ observations: FredObservation[] }>(
    "/series/observations",
    {
      series_id: seriesId,
      observation_start: thirtyDaysAgo,
      limit: "5",
      sort_order: "desc",
    },
  );
  const obs = data?.observations;
  if (!Array.isArray(obs) || obs.length === 0) return null;
  // Find most recent non-"." value
  return obs.find((o) => o.value && o.value !== ".") ?? null;
}

// ── Economic Calendar from FRED Release Dates ─────────────────────────────────
// FRED publishes scheduled release dates for every major US data release.
// Using include_release_dates_with_no_data=true returns FUTURE dates too.

interface FredReleaseDatesResponse {
  release_dates: Array<{ release_id: number; date: string }>;
}

interface FredReleaseConfig {
  id: number;
  name: string;
  currency: "USD";
  impact: "high" | "medium" | "low";
  /** Approximate time string (HH:MM:SS UTC) for this release */
  utcTime: string;
}

const FRED_RELEASES: FredReleaseConfig[] = [
  { id: 47,  name: "Consumer Price Index",        currency: "USD", impact: "high",   utcTime: "12:30:00" },
  { id: 10,  name: "Non Farm Payrolls",            currency: "USD", impact: "high",   utcTime: "12:30:00" },
  { id: 33,  name: "GDP Growth Rate",              currency: "USD", impact: "high",   utcTime: "12:30:00" },
  { id: 46,  name: "PCE Price Index",              currency: "USD", impact: "medium", utcTime: "12:30:00" },
  { id: 14,  name: "Producer Price Index",         currency: "USD", impact: "medium", utcTime: "12:30:00" },
  { id: 175, name: "ADP Employment Change",        currency: "USD", impact: "medium", utcTime: "12:15:00" },
  { id: 82,  name: "Employment Cost Index",        currency: "USD", impact: "medium", utcTime: "12:30:00" },
];

let fredCalendarCache: import("../parser/calendarParser.js").CalendarEvent[] | null = null;
let fredCalendarCacheTime = 0;
const FRED_CALENDAR_TTL = 6 * 60 * 60_000; // 6 hours

function makeFredId(name: string, date: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return `${date}_${slug}`;
}

async function fetchReleaseDates(rel: FredReleaseConfig): Promise<string[]> {
  // Fetch last 24 releases sorted desc (newest first) then filter client-side
  // to the window today-7d → today+60d.  FRED realtime_* params filter by
  // observation vintage, not release date, so client-side filtering is required.
  const data = await fredFetch<FredReleaseDatesResponse>("/release/dates", {
    release_id: String(rel.id),
    include_release_dates_with_no_data: "true",
    sort_order: "desc",
    limit: "24",
  });
  const all = data?.release_dates?.map((d) => d.date) ?? [];
  const lookback  = Date.now() - 7  * 86_400_000;
  const lookahead = Date.now() + 60 * 86_400_000;
  return all
    .filter((date) => {
      const ts = new Date(date).getTime();
      return ts >= lookback && ts <= lookahead;
    })
    .sort(); // ascending order for calendar display
}

export async function getFredCalendarEvents(): Promise<import("../parser/calendarParser.js").CalendarEvent[]> {
  const now = Date.now();
  if (fredCalendarCache && now - fredCalendarCacheTime < FRED_CALENDAR_TTL) {
    logger.info({ count: fredCalendarCache.length }, "FRED calendar (from cache)");
    return fredCalendarCache;
  }

  if (!API_KEY) {
    logger.warn("FRED_API_KEY not set — skipping FRED calendar provider");
    return [];
  }

  logger.info({ releases: FRED_RELEASES.length }, "FRED calendar request — fetching release schedules");

  const events: import("../parser/calendarParser.js").CalendarEvent[] = [];

  const results = await Promise.allSettled(
    FRED_RELEASES.map(async (rel) => {
      const dates = await fetchReleaseDates(rel);
      return { rel, dates };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { rel, dates } = result.value;

    for (const date of dates) {
      const isoTime = new Date(`${date}T${rel.utcTime}Z`).toISOString();
      const eventMs = new Date(isoTime).getTime();
      const isReleased = eventMs < now;

      events.push({
        id: makeFredId(rel.name, isoTime),
        canonicalId: `fred_${rel.id}_${date}`,
        name: rel.name,
        currency: rel.currency,
        country: "US",
        category: "macro",
        impact: rel.impact,
        time: isoTime,
        actual: null,
        forecast: null,
        previous: null,
        source: "fred",
        hasActual: false,
        isReleased,
      });
    }
  }

  // Sort by time
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const upcoming = events.filter((e) => !e.isReleased).length;
  logger.info({ total: events.length, upcoming }, "FRED calendar response");

  if (events.length > 0) {
    fredCalendarCache = events;
    fredCalendarCacheTime = now;
  }

  return events;
}

export function invalidateFredCalendarCache(): void {
  fredCalendarCacheTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getMacroSnapshot(): Promise<Record<string, { name: string; value: string; date: string }>> {
  const results: Record<string, { name: string; value: string; date: string }> = {};
  await Promise.allSettled(
    Object.entries(KEY_SERIES).map(async ([id, name]) => {
      const obs = await getLatestObservation(id);
      if (obs) results[id] = { name, value: obs.value, date: obs.date };
    }),
  );
  return results;
}
