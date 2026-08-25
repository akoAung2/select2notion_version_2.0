/**
 * ForexFactory Calendar Scraper
 * Scrapes economic calendar data from ForexFactory
 */

import * as cheerio from "cheerio";
import { logger } from "../../lib/logger.js";
import { normalizeImpact } from "../../engine/normalization.js";

export interface ScrapedEvent {
  name: string;
  currency: string;
  time: string;
  impact: "high" | "medium" | "low";
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: "forexfactory";
}

const FF_URL = "https://www.forexfactory.com/calendar";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.forexfactory.com/",
};

export async function scrapeForexFactory(): Promise<ScrapedEvent[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const resp = await fetch(FF_URL, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "ForexFactory scraper HTTP error");
      return [];
    }

    const html = await resp.text();
    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    let currentTime = "";

    $("tr.calendar__row").each((_i, row) => {
      const $row = $(row);

      // Extract time if present
      const timeText = $row.find("td.calendar__time").text().trim();
      if (timeText && timeText !== "All Day") {
        currentTime = timeText;
      }

      const currency = $row.find("td.calendar__currency").text().trim();
      if (currency !== "USD") return; // Only USD events

      const eventName = $row.find("td.calendar__event span.calendar__event-title").text().trim()
        || $row.find("td.calendar__event").text().trim();
      if (!eventName) return;

      const impactClass = $row.find("td.calendar__impact span").attr("class") ?? "";
      let impactRaw = "low";
      if (impactClass.includes("high")) impactRaw = "high";
      else if (impactClass.includes("medium")) impactRaw = "medium";
      else if (impactClass.includes("low")) impactRaw = "low";

      const actual = $row.find("td.calendar__actual").text().trim() || null;
      const forecast = $row.find("td.calendar__forecast").text().trim() || null;
      const previous = $row.find("td.calendar__previous").text().trim() || null;

      // Build full datetime
      const today = new Date().toISOString().split("T")[0];
      let isoTime = `${today}T00:00:00Z`;
      if (currentTime) {
        try {
          const [timePart, ampm] = currentTime.split(" ");
          const [h, m] = timePart.split(":").map(Number);
          let hour = h;
          if (ampm?.toLowerCase() === "pm" && h !== 12) hour += 12;
          if (ampm?.toLowerCase() === "am" && h === 12) hour = 0;
          const d = new Date();
          d.setUTCHours(hour + 5, m, 0, 0); // FF shows ET, convert to UTC approx
          isoTime = d.toISOString();
        } catch { /* keep default */ }
      }

      events.push({
        name: eventName,
        currency,
        time: isoTime,
        impact: normalizeImpact(impactRaw),
        actual: actual === "" ? null : actual,
        forecast: forecast === "" ? null : forecast,
        previous: previous === "" ? null : previous,
        source: "forexfactory",
      });
    });

    logger.info({ count: events.length }, "ForexFactory scrape complete");
    return events;
  } catch (err) {
    logger.error({ err }, "ForexFactory scraper error");
    return [];
  }
}
