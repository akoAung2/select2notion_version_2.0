/**
 * Calendar Parser
 * Normalizes events from multiple sources into unified CalendarEvent format
 */

import { normalizeEventName, getEventCategory, normalizeImpact } from "../../engine/normalization.js";
import type { NormalizedFmpEvent } from "../api/fmpClient.js";
import type { ScrapedEvent } from "../scraper/forexFactoryScraper.js";

export interface CalendarEvent {
  id: string;
  canonicalId: string;
  name: string;
  currency: string;
  country: string;
  category: string;
  impact: "high" | "medium" | "low";
  time: string; // ISO
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
  hasActual: boolean;
  isReleased: boolean;
}

function makeId(name: string, time: string): string {
  const date = time.split("T")[0];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return `${date}_${slug}`;
}

export function parseFmpEvent(e: NormalizedFmpEvent): CalendarEvent {
  const canonicalId = normalizeEventName(e.event);
  const now = new Date();
  const eventTime = new Date(e.date);
  return {
    id: makeId(e.event, e.date),
    canonicalId,
    name: e.event,
    currency: e.currency || "USD",
    country: e.country || "US",
    category: getEventCategory(canonicalId),
    impact: normalizeImpact(e.impact),
    time: e.date,
    actual: e.actual || null,
    forecast: e.estimate || null,
    previous: e.previous || null,
    source: "fmp",
    hasActual: !!e.actual,
    isReleased: !!e.actual || eventTime < now,
  };
}

export function parseScrapedEvent(e: ScrapedEvent): CalendarEvent {
  const canonicalId = normalizeEventName(e.name);
  const now = new Date();
  const eventTime = new Date(e.time);
  return {
    id: makeId(e.name, e.time),
    canonicalId,
    name: e.name,
    currency: e.currency,
    country: "US",
    category: getEventCategory(canonicalId),
    impact: e.impact,
    time: e.time,
    actual: e.actual,
    forecast: e.forecast,
    previous: e.previous,
    source: e.source,
    hasActual: !!e.actual,
    isReleased: !!e.actual || eventTime < now,
  };
}

export function mergeAndDedup(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>();
  for (const e of events) {
    const existing = seen.get(e.id);
    if (!existing) {
      seen.set(e.id, e);
    } else {
      // Prefer event with more data
      if (!existing.actual && e.actual) seen.set(e.id, e);
      else if (existing.impact === "low" && e.impact !== "low") seen.set(e.id, e);
    }
  }
  return Array.from(seen.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export function filterHighImpact(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => e.impact === "high");
}

export function getUpcomingEvents(events: CalendarEvent[], withinMinutes: number): CalendarEvent[] {
  const now = Date.now();
  return events.filter((e) => {
    const eventMs = new Date(e.time).getTime();
    const diff = eventMs - now;
    return diff > 0 && diff <= withinMinutes * 60_000;
  });
}

export function getRecentlyReleased(events: CalendarEvent[], withinMinutes = 30): CalendarEvent[] {
  const now = Date.now();
  return events.filter((e) => {
    if (!e.hasActual) return false;
    const eventMs = new Date(e.time).getTime();
    const diff = now - eventMs;
    return diff >= 0 && diff <= withinMinutes * 60_000;
  });
}
