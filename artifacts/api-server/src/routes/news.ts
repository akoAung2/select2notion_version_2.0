/**
 * News Intelligence Dashboard API Routes
 */

import { Router } from "express";
import { logger } from "../lib/logger.js";
import { fetchAllCalendarData, getPollingStats, pollCycle } from "../news/polling/pollingEngine.js";
import { getEventsFromFirestore } from "../engine/eventEngine.js";
import { getRecentAIReports, generateNewsAnalysis } from "../ai/geminiService.js";
import { getRecentTelegramLogs } from "../engine/telegramBroadcast.js";
import { getBreakingBusinessNews, getForexNews } from "../news/api/newsApiClient.js";
import { getMacroSnapshot } from "../news/api/fredClient.js";
import { getMarketSnapshot } from "../news/api/alphaVantageClient.js";
import { getSchedulerStatus } from "../scheduler/cron.js";
import { filterHighImpact, getUpcomingEvents, getRecentlyReleased } from "../news/parser/calendarParser.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";
import { getAuth } from "firebase-admin/auth";

async function getUserFromToken(req: import("express").Request): Promise<{ uid: string } | null> {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

const router = Router();

// ── GET /api/news/calendar ─────────────────────────────────────────────────
router.get("/news/calendar", async (_req, res) => {
  try {
    const events = await fetchAllCalendarData();
    const highImpact = filterHighImpact(events);
    const upcoming = getUpcomingEvents(events, 120);
    const recentlyReleased = getRecentlyReleased(events, 60);
    res.json({
      ok: true,
      events,
      highImpact,
      upcoming,
      recentlyReleased,
      total: events.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Calendar route error");
    res.status(500).json({ ok: false, error: "Failed to fetch calendar" });
  }
});

// ── GET /api/news/events ───────────────────────────────────────────────────
router.get("/news/events", async (_req, res) => {
  try {
    const [cached, stored] = await Promise.allSettled([
      fetchAllCalendarData(),
      getEventsFromFirestore(100),
    ]);
    const cachedEvents = cached.status === "fulfilled" ? cached.value : [];
    const storedEvents = stored.status === "fulfilled" ? stored.value : [];
    res.json({ ok: true, cached: cachedEvents, stored: storedEvents });
  } catch (err) {
    logger.error({ err }, "Events route error");
    res.status(500).json({ ok: false, error: "Failed to fetch events" });
  }
});

// ── GET /api/news/headlines ────────────────────────────────────────────────
router.get("/news/headlines", async (_req, res) => {
  try {
    const [forex, business] = await Promise.allSettled([
      getForexNews(),
      getBreakingBusinessNews(),
    ]);

    const forexNews = forex.status === "fulfilled" ? forex.value : [];
    const businessNews = business.status === "fulfilled" ? business.value : [];

    if (isAdminReady() && (forexNews.length > 0 || businessNews.length > 0)) {
      const allNews = [...forexNews, ...businessNews]
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, 20);
      getAdminDb()
        .collection("news_cache")
        .doc("latest")
        .set({
          articles: allNews,
          cachedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        })
        .catch(() => {});
    }

    // Both live providers returned empty — fall back to Firestore cache so users never see a blank news section
    if (forexNews.length === 0 && businessNews.length === 0 && isAdminReady()) {
      try {
        const cached = await getAdminDb().collection("news_cache").doc("latest").get();
        if (cached.exists) {
          const cacheData = cached.data() as { articles?: Array<Record<string, unknown>> } | undefined;
          const articles = cacheData?.articles ?? [];
          if (articles.length > 0) {
            logger.info({ count: articles.length }, "Headlines: live providers empty — serving Firestore cache");
            const half = Math.ceil(articles.length / 2);
            res.json({
              ok: true,
              forex: articles.slice(0, half),
              business: articles.slice(half),
              news: articles,
              fromCache: true,
              fetchedAt: new Date().toISOString(),
            }); return;
          }
        }
      } catch (cacheErr) {
        logger.warn({ err: cacheErr }, "Headlines Firestore fallback failed");
      }
    }

    res.json({
      ok: true,
      forex: forexNews,
      business: businessNews,
      news: [...forexNews, ...businessNews].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      ),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Headlines route error");
    res.status(500).json({ ok: false, error: "Failed to fetch headlines" });
  }
});

// ── GET /api/news/macro-bias ───────────────────────────────────────────────
router.get("/news/macro-bias", async (_req, res) => {
  try {
    const [fred, market] = await Promise.allSettled([
      getMacroSnapshot(),
      getMarketSnapshot(),
    ]);
    const fredData = fred.status === "fulfilled" ? fred.value : {};
    const marketData = market.status === "fulfilled" ? market.value : {};

    let overallBias = "neutral";
    let bullishCount = 0;
    let bearishCount = 0;
    try {
      const reports = await getRecentAIReports(5);
      bullishCount = reports.filter((r) => r.usdBias === "bullish").length;
      bearishCount = reports.filter((r) => r.usdBias === "bearish").length;
      if (bullishCount > bearishCount) overallBias = "bullish";
      else if (bearishCount > bullishCount) overallBias = "bearish";
    } catch { /* ignore */ }

    res.json({
      ok: true,
      usdBias: overallBias,
      bullishSignals: bullishCount,
      bearishSignals: bearishCount,
      macroData: fredData,
      marketRates: marketData,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Macro-bias route error");
    res.status(500).json({ ok: false, error: "Failed to fetch macro bias" });
  }
});

// ── GET /api/news/ai-reports ───────────────────────────────────────────────
router.get("/news/ai-reports", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const reports = await getRecentAIReports(limit);
    res.json({ ok: true, reports, total: reports.length });
  } catch (err) {
    logger.error({ err }, "AI reports route error");
    res.status(500).json({ ok: false, error: "Failed to fetch AI reports" });
  }
});

// ── GET /api/news/telegram-logs ────────────────────────────────────────────
router.get("/news/telegram-logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const logs = await getRecentTelegramLogs(limit);
    res.json({ ok: true, logs });
  } catch (err) {
    logger.error({ err }, "Telegram logs route error");
    res.status(500).json({ ok: false, error: "Failed to fetch Telegram logs" });
  }
});

// ── GET /api/news/status ───────────────────────────────────────────────────
router.get("/news/status", (_req, res) => {
  res.json({
    ok: true,
    polling: getPollingStats(),
    scheduler: getSchedulerStatus(),
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/news/refresh ─────────────────────────────────────────────────
router.post("/news/refresh", async (_req, res) => {
  try {
    await pollCycle();
    res.json({ ok: true, message: "Poll cycle triggered", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "Refresh route error");
    res.status(500).json({ ok: false, error: "Refresh failed" });
  }
});

// ── POST /api/news/ask-ai ──────────────────────────────────────────────────
// Auth is optional — unauthenticated users fall back to the system Gemini key.
// When authenticated, the user's own API key + model are used (per-user routing).
router.post("/news/ask-ai", async (req, res) => {
  try {
    const { title, description, content, source, publishedAt, url } = req.body as {
      title?: string;
      description?: string | null;
      content?: string | null;
      source?: string;
      publishedAt?: string;
      url?: string;
    };

    if (!title) {
      res.status(400).json({ ok: false, error: "title is required" }); return;
    }

    // Extract authenticated user ID (optional — enhances key routing + cache isolation)
    const user = await getUserFromToken(req);
    const uid = user?.uid ?? null;

    // Use URL as cache key if available
    const newsId = url ? Buffer.from(url).toString("base64").slice(0, 40) : undefined;

    const analysis = await generateNewsAnalysis(
      {
        title: title.trim(),
        description: description ?? null,
        content: content ?? null,
        source: source ?? "Unknown",
        publishedAt: publishedAt ?? new Date().toISOString(),
      },
      newsId,
      uid,
    );

    res.json({ ok: true, analysis, uid: uid ?? "anonymous" });
  } catch (err) {
    logger.error({ err }, "Ask AI route error");
    res.status(500).json({ ok: false, error: "AI analysis failed" });
  }
});

// ── GET /api/news/user-settings ────────────────────────────────────────────
router.get("/news/user-settings", async (req, res) => {
  try {
    const user = await getUserFromToken(req);
    if (!user) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    if (!isAdminReady()) { res.json({ ok: true, settings: getDefaultNewsSettings() }); return; }

    const doc = await getAdminDb().collection("user_settings").doc(user.uid).get();
    const data = doc.exists ? (doc.data() ?? {}) : {};

    const settings = {
      telegram: {
        news_alert_timing: data.telegram?.news_alert_timing ?? [60, 30, 15, 5, 1],
      },
      news_filters: {
        impact: data.news_filters?.impact ?? ["HIGH", "MEDIUM", "LOW"],
        currency: data.news_filters?.currency ?? ["USD", "EUR", "GBP", "JPY"],
      },
    };

    res.json({ ok: true, settings });
  } catch (err) {
    logger.error({ err }, "User settings GET error");
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

// ── POST /api/news/user-settings ───────────────────────────────────────────
router.post("/news/user-settings", async (req, res) => {
  try {
    const user = await getUserFromToken(req);
    if (!user) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { telegram, news_filters } = req.body as {
      telegram?: { news_alert_timing?: number[] };
      news_filters?: { impact?: string[]; currency?: string[] };
    };

    if (!isAdminReady()) { res.json({ ok: true, message: "Settings saved (no-op in dev)" }); return; }

    const update: Record<string, unknown> = {};

    if (telegram?.news_alert_timing) {
      const valid = [60, 30, 15, 5, 1];
      update["telegram.news_alert_timing"] = telegram.news_alert_timing.filter((t) => valid.includes(t));
    }
    if (news_filters?.impact) {
      const valid = ["HIGH", "MEDIUM", "LOW"];
      update["news_filters.impact"] = news_filters.impact.filter((i) => valid.includes(i));
    }
    if (news_filters?.currency) {
      const valid = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];
      update["news_filters.currency"] = news_filters.currency.filter((c) => valid.includes(c));
    }

    if (Object.keys(update).length > 0) {
      await getAdminDb().collection("user_settings").doc(user.uid).set(update, { merge: true });
    }

    res.json({ ok: true, message: "News settings saved" });
  } catch (err) {
    logger.error({ err }, "User settings POST error");
    res.status(500).json({ ok: false, error: "Failed to save settings" });
  }
});

function getDefaultNewsSettings() {
  return {
    telegram: { news_alert_timing: [60, 30, 15, 5, 1] },
    news_filters: {
      impact: ["HIGH", "MEDIUM", "LOW"],
      currency: ["USD", "EUR", "GBP", "JPY"],
    },
  };
}

// ── POST /api/news/test-event ───────────────────────────────────────────────
// Fake CPI / high-impact event end-to-end test.
// Fires the FULL pipeline: Event Engine → Redis Queue → AI Worker → Telegram.
// Only accessible from localhost (127.0.0.1) to prevent public abuse.
import { processReleasedEvent } from "../engine/eventEngine.js";
import type { CalendarEvent } from "../news/parser/calendarParser.js";

router.post("/news/test-event", async (req, res) => {
  // Auth: require X-Test-Secret header matching SESSION_SECRET.
  // This is a destructive endpoint (fires Gemini + Telegram for all users) —
  // must not be reachable without explicit authorization regardless of NODE_ENV or IP.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    res.status(503).json({ ok: false, error: "Test endpoint disabled — SESSION_SECRET not configured" });
    return;
  }
  const provided = req.headers["x-test-secret"] as string | undefined;
  if (!provided || provided !== sessionSecret) {
    res.status(403).json({ ok: false, error: "Forbidden — provide correct X-Test-Secret header" });
    return;
  }

  const now = new Date();
  const body = req.body as { name?: string; actual?: string; forecast?: string; previous?: string; impact?: string; currency?: string };
  const testEvent: CalendarEvent = {
    id: `test_cpi_${Date.now()}`,
    name: body.name ?? "US CPI MoM (Test)",
    actual: body.actual ?? "0.4%",
    forecast: body.forecast ?? "0.3%",
    previous: body.previous ?? "0.2%",
    time: now.toISOString(),
    impact: (body.impact ?? "high") as "high" | "medium" | "low",
    currency: body.currency ?? "USD",
    country: "US",
    category: "inflation",
    hasActual: true,
    isReleased: true,
    source: "test",
    canonicalId: "US_CPI_MOM_TEST",
  };

  logger.info({ event: testEvent.name, impact: testEvent.impact }, "Test event injected — running full pipeline");

  // Fire-and-forget so the response is instant
  processReleasedEvent(testEvent).catch((err) =>
    logger.error({ err }, "Test event pipeline error"),
  );

  res.json({
    ok: true,
    message: "Test event injected into pipeline",
    event: {
      id: testEvent.id,
      name: testEvent.name,
      actual: testEvent.actual,
      forecast: testEvent.forecast,
      impact: testEvent.impact,
      currency: testEvent.currency,
    },
    pipeline: "Event Engine → Redis Queue → AI Worker → Gemini → Telegram",
    note: "Check /api/health/redis for worker stats and Firestore ai_reports collection for results",
  });
});

export default router;
