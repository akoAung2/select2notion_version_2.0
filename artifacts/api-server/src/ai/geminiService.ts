/**
 * Gemini AI Service for News Intelligence
 * - Uses the AUTHENTICATED user's own Gemini API key + model from Firestore
 * - Falls back to GOOGLE_API_KEY system env var only when no user key is available
 * - Cache is user + model aware (no cross-user cache sharing)
 * - Parallel: user config + cache lookup run simultaneously for speed
 */

import { createHash } from "node:crypto";
import { callGeminiModel } from "../lib/aiEngine.js";
import { logger } from "../lib/logger.js";
import { buildFundamentalAnalysisPrompt, buildWarningPrompt, buildNewsAnalysisPrompt, type AnalysisInput, type NewsAnalysisInput } from "./promptTemplate.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";

const SYSTEM_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const SYSTEM_MODEL   = "gemini-2.5-flash";

/**
 * Per-key rate-limit tracker.
 * When a 429/rate_limited error occurs, we record `Date.now() + backoffMs`
 * so subsequent calls with the same key skip Gemini until the backoff expires.
 *
 * Map key = SHA-256 hex digest (first 16 chars): collision-resistant and never
 * logs or stores raw key material. Expired entries are pruned on every read to
 * prevent unbounded Map growth over long uptime.
 */
const _keyBackoff = new Map<string, number>();
const KEY_BACKOFF_MS = 60_000; // 60 s per-key cooling period after a rate limit

/** Returns a 16-char hex SHA-256 digest of the API key — safe to log/store. */
function keyId(apiKey: string): string {
  if (!apiKey) return "empty";
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function isKeyRateLimited(apiKey: string): boolean {
  const id    = keyId(apiKey);
  const until = _keyBackoff.get(id);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    _keyBackoff.delete(id); // prune expired entry — prevents unbounded growth
    return false;
  }
  return true;
}

function markKeyRateLimited(apiKey: string, backoffMs = KEY_BACKOFF_MS): void {
  _keyBackoff.set(keyId(apiKey), Date.now() + backoffMs);
  logger.warn({ keyId: keyId(apiKey), backoffMs }, "Gemini key rate-limited — cooling off");
}

export interface AssetImpact {
  asset: string;
  direction: "up" | "down" | "neutral";
  strength: string;
  reason: string;
}

export interface AIReport {
  eventId: string;
  eventName: string;
  analysis: string;
  generatedAt: string;
  usdBias: string;
  riskSentiment: string;
  affectedAssets?: AssetImpact[];
}

/**
 * Resolves the Gemini API key for a SPECIFIC user (by their UID).
 * Falls back to the system GOOGLE_API_KEY only when:
 *   - uid is null/undefined (unauthenticated request), OR
 *   - the user has no Gemini key configured in Firestore
 *
 * This replaces the old "first user" pattern which incorrectly shared keys.
 */
export async function resolveGeminiKeyForUser(
  uid: string | null | undefined,
  eventId?: string,
): Promise<{ key: string; model: string; source: "user_key" | "system_fallback" }> {
  if (uid && isAdminReady()) {
    try {
      const snap = await getAdminDb().collection("user_connections").doc(uid).get();
      if (snap.exists) {
        const d = snap.data() ?? {};
        const aiKey    = d.ai_api_key  as string | undefined;
        const aiProvider = d.ai_provider as string | undefined;
        if (aiProvider === "gemini" && aiKey) {
          const model = (d.ai_model as string | undefined) ?? SYSTEM_MODEL;
          if (isKeyRateLimited(aiKey)) {
            logger.warn({ uid, keyId: keyId(aiKey), eventId }, "User key in back-off — falling through to system key");
          } else {
            logger.info({ uid, model, apiKeySource: "user_key", eventId }, "Using user Gemini API key");
            return { key: aiKey, model, source: "user_key" };
          }
        }
      }
    } catch (err) {
      logger.warn({ err, uid }, "Could not load user Gemini config — falling back to system key");
    }
  }
  // System fallback — log at WARN level so it's visible when unexpected
  const source: "user_key" | "system_fallback" = "system_fallback";
  logger.warn({ uid: uid ?? "anonymous", apiKeySource: source, model: SYSTEM_MODEL, eventId },
    uid ? "User has no Gemini key configured — using system GOOGLE_API_KEY" : "Unauthenticated call — using system GOOGLE_API_KEY");
  return { key: SYSTEM_API_KEY, model: SYSTEM_MODEL, source };
}

async function callGeminiForUser(
  prompt: string,
  uid: string | null | undefined,
  eventId?: string,
): Promise<string> {
  const { key, model, source } = await resolveGeminiKeyForUser(uid, eventId);
  if (!key) {
    logger.warn({ uid, eventId }, "No Gemini API key available — skipping AI analysis");
    return "AI analysis unavailable — please configure your Gemini API key in Settings.";
  }
  try {
    return await callGeminiModel(
      key,
      model,
      [{ role: "user", text: prompt }],
      // Myanmar Unicode costs 3-5× more tokens than English — minimum 2000
      { temperature: 0.3, maxOutputTokens: 2000 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("rate_limited:")) {
      // Track this key so subsequent calls back off automatically
      markKeyRateLimited(key);
      const friendly = source === "user_key"
        ? "Your Gemini API key has reached its rate limit. Please wait a moment and try again."
        : "System Gemini key is rate-limited. Please configure your own Gemini API key in Settings.";
      throw new Error(friendly);
    }
    if (msg === "invalid_key" || msg.startsWith("auth_error:")) {
      throw new Error("Your Gemini API key is invalid or expired. Please update it in Settings.");
    }
    throw err;
  }
}

export async function generateFundamentalAnalysis(
  input: AnalysisInput,
  uid?: string | null,
  eventId?: string,
): Promise<string> {
  const prompt = buildFundamentalAnalysisPrompt(input);
  try {
    const result = await callGeminiForUser(prompt, uid, eventId);
    return result || "Analysis generation failed.";
  } catch (err) {
    logger.error({ err, event: input.eventName, uid, eventId }, "Gemini fundamental analysis error");
    return `Analysis error: ${err instanceof Error ? err.message : "unknown"}`;
  }
}

export async function generateWarningMessage(
  eventName: string,
  minutesBefore: number,
  forecast: string | null,
  previous: string | null,
): Promise<string> {
  const prompt = buildWarningPrompt(eventName, minutesBefore, forecast, previous);
  try {
    return await callGeminiForUser(prompt, null);
  } catch (err) {
    logger.error({ err, event: eventName }, "Gemini warning generation error");
    const emoji = minutesBefore <= 5 ? "🔴" : minutesBefore <= 15 ? "🟠" : minutesBefore <= 30 ? "🟡" : "🟢";
    return `${emoji} ${minutesBefore}-Min Warning: ${eventName}\n📅 Forecast: ${forecast ?? "N/A"}\n📌 Previous: ${previous ?? "N/A"}`;
  }
}

/**
 * Analyze a news article using the user's own Gemini API key + model.
 *
 * Cache key = `{uid}:{model}:{newsId}` — fully user+model aware.
 * Cache and user config are fetched in PARALLEL for speed.
 * Cached entries < 120 chars are treated as truncated and regenerated.
 */
export async function generateNewsAnalysis(
  input: NewsAnalysisInput,
  newsId?: string,
  uid?: string | null,
): Promise<string> {
  // Resolve user config and check cache IN PARALLEL
  const baseKey = newsId ?? Buffer.from(input.title).toString("base64").slice(0, 40);

  const [{ key, model }, cachedEntry] = await Promise.all([
    resolveGeminiKeyForUser(uid),
    isAdminReady() ? getAdminDb().collection("ai_news_analysis").doc(baseKey).get().catch(() => null) : Promise.resolve(null),
  ]);

  // Build user+model aware cache key — avoids cross-user cache sharing
  const cacheKey = uid ? `${uid}:${model}:${baseKey}` : baseKey;

  // Check cache — look up user-specific key first, then generic key for backwards compat
  if (isAdminReady()) {
    try {
      const userCached = await getAdminDb().collection("ai_news_analysis").doc(cacheKey).get();
      if (userCached.exists) {
        const data = userCached.data()!;
        const summary = data.summary as string;
        if (summary && summary.length >= 120) {
          logger.info({ cacheKey, uid }, "News analysis cache hit (user-aware)");
          return summary;
        }
        logger.warn({ cacheKey, len: summary?.length }, "Cached analysis too short (truncated) — regenerating");
        await getAdminDb().collection("ai_news_analysis").doc(cacheKey).delete().catch(() => {});
      } else if (cachedEntry?.exists) {
        // Legacy generic cache entry — reuse if valid
        const data = cachedEntry.data()!;
        const summary = data.summary as string;
        if (summary && summary.length >= 120) {
          logger.info({ baseKey, uid }, "News analysis legacy cache hit");
          return summary;
        }
      }
    } catch { /* ignore cache read errors */ }
  }

  // Check key availability and per-key rate-limit back-off
  if (!key) {
    return "AI analysis unavailable — please configure your Gemini API key in Settings.";
  }
  if (isKeyRateLimited(key)) {
    logger.warn({ uid, newsId: baseKey }, "Gemini key in back-off — skipping news analysis");
    return "⚠️ Gemini API rate limit reached. Please wait a moment and try again.";
  }

  // Generate analysis
  const prompt = buildNewsAnalysisPrompt(input);
  let analysis: string;
  try {
    analysis = await callGeminiModel(
      key,
      model,
      [{ role: "user", text: prompt }],
      { temperature: 0.3, maxOutputTokens: 2000 },
    );
    if (!analysis) analysis = "Analysis generation failed.";
  } catch (err: unknown) {
    logger.error({ err, title: input.title }, "Gemini news analysis error");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("rate_limited:")) {
      markKeyRateLimited(key); // back off this key — consistent with callGeminiForUser
      return "⚠️ Gemini API rate limit reached. Please wait a moment and try again.";
    }
    if (msg === "invalid_key" || msg.startsWith("auth_error:")) {
      return "⚠️ Your Gemini API key is invalid or expired. Please update it in Settings.";
    }
    return `Analysis error: ${msg}`;
  }

  // Cache with user+model aware key
  if (isAdminReady()) {
    try {
      await getAdminDb().collection("ai_news_analysis").doc(cacheKey).set({
        newsId: baseKey,
        userId: uid ?? "system",
        model,
        title: input.title,
        summary: analysis,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      });
    } catch { /* ignore cache write errors */ }
  }

  return analysis;
}

export async function saveAIReport(report: AIReport): Promise<void> {
  if (!isAdminReady()) return;
  try {
    await getAdminDb().collection("ai_reports").doc(report.eventId).set({
      ...report,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    });
  } catch (err) {
    logger.error({ err }, "Failed to save AI report");
  }
}

export async function getRecentAIReports(limit = 10): Promise<AIReport[]> {
  if (!isAdminReady()) return [];
  try {
    const snap = await getAdminDb()
      .collection("ai_reports")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as AIReport);
  } catch (err) {
    logger.error({ err }, "Failed to load AI reports");
    return [];
  }
}

export async function getRecentTelegramLogsFromService(limit = 20) {
  if (!isAdminReady()) return [];
  try {
    const snap = await getAdminDb()
      .collection("telegram_logs")
      .orderBy("sentAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}
