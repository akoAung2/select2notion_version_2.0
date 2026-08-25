/**
 * Investing.com Economic Calendar Scraper
 * Fallback scraper — Investing.com has Cloudflare protection so may not always work
 */

import * as cheerio from "cheerio";
import { logger } from "../../lib/logger.js";
import { normalizeImpact } from "../../engine/normalization.js";
import type { ScrapedEvent } from "./forexFactoryScraper.js";

const INV_URL = "https://www.investing.com/economic-calendar/";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.google.com/",
  "X-Requested-With": "XMLHttpRequest",
};

export async function scrapeInvesting(): Promise<ScrapedEvent[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const resp = await fetch(INV_URL, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Investing.com scraper HTTP error (possibly Cloudflare blocked)");
      return [];
    }

    const html = await resp.text();

    // Detect Cloudflare block
    if (html.includes("cf-browser-verification") || html.includes("Checking your browser")) {
      logger.warn("Investing.com blocked by Cloudflare — returning empty");
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $("#economicCalendarData tr.js-event-item").each((_i, row) => {
      const $row = $(row);
      const currency = $row.find("td.flagCur span").text().trim();
      if (currency !== "USD") return;

      const name = $row.find("td.event a").text().trim();
      if (!name) return;

      const impactBulls = $row.find("td.sentiment i.grayFullBullishIcon").length
        + $row.find("td.sentiment i.redFullBullishIcon").length;
      let impactRaw = "low";
      if (impactBulls >= 3) impactRaw = "high";
      else if (impactBulls === 2) impactRaw = "medium";

      const actual = $row.find("td.act").text().trim() || null;
      const forecast = $row.find("td.fore").text().trim() || null;
      const previous = $row.find("td.prev").text().trim() || null;

      const timeText = $row.find("td.time").text().trim();
      const today = new Date().toISOString().split("T")[0];
      let isoTime = `${today}T00:00:00Z`;
      if (timeText) {
        try {
          const [h, m] = timeText.split(":").map(Number);
          const d = new Date();
          d.setUTCHours(h + 5, m, 0, 0); // ET → UTC
          isoTime = d.toISOString();
        } catch { /* keep default */ }
      }

      events.push({
        name,
        currency,
        time: isoTime,
        impact: normalizeImpact(impactRaw),
        actual: actual === "" ? null : actual,
        forecast: forecast === "" ? null : forecast,
        previous: previous === "" ? null : previous,
        source: "forexfactory",
      });
    });

    logger.info({ count: events.length }, "Investing.com scrape complete");
    return events;
  } catch (err) {
    logger.error({ err }, "Investing.com scraper error");
    return [];
  }
}
