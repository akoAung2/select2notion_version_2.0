/**
 * Alpha Vantage API Client
 * Forex rates and market data — FMP primary (parallel), AV fallback
 * Eliminates 58-second sequential delay by fetching all pairs in parallel via FMP
 */

import { logger } from "../../lib/logger.js";

const AV_BASE = "https://www.alphavantage.co/query";
const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";
const FMP_BASE = "https://financialmodelingprep.com/stable";
const FMP_KEY = process.env.FMP_API_KEY ?? "";

// In-memory rate cache — refresh every 5 minutes, but keep stale for 30 min
// so rate-limit windows (FMP free plan ~250 req/day) don't blank out all prices.
let marketCache: MarketSnapshot | null = null;
let marketCacheTime = 0;
const MARKET_CACHE_TTL = 5 * 60_000;
const MARKET_STALE_TTL = 30 * 60_000; // serve stale prices for up to 30 min

export interface ForexRate {
  pair: string;
  rate: string;
  bid: string;
  ask: string;
  timestamp: string;
}

export interface MarketSnapshot {
  EURUSD: string | null;
  GBPUSD: string | null;
  USDJPY: string | null;
  USDCHF: string | null;
  XAUUSD: string | null;
}

/**
 * FMP primary: parallel-safe, no rate-limit delays needed
 */
async function getForexRateFMP(pair: string): Promise<string | null> {
  if (!FMP_KEY) return null;
  try {
    const url = `${FMP_BASE}/fx?symbol=${pair}&apikey=${FMP_KEY}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json() as Array<{ bid?: number; ask?: number; price?: number }>;
    if (Array.isArray(data) && data.length > 0) {
      const item = data[0];
      const rate = item.price ?? ((item.bid != null && item.ask != null) ? (item.bid + item.ask) / 2 : null);
      return rate != null ? String(rate) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * AV fallback: only called when FMP fails — note: AV has 5 req/min limit on free tier
 */
async function getForexRateAV(from: string, to: string): Promise<string | null> {
  if (!AV_KEY) return null;
  const url = new URL(AV_BASE);
  const params: Record<string, string> = { function: "CURRENCY_EXCHANGE_RATE", from_currency: from, to_currency: to };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", AV_KEY);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Alpha Vantage API error");
      return null;
    }
    const data = await resp.json() as {
      "Realtime Currency Exchange Rate"?: { "5. Exchange Rate": string };
    };
    return data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"] ?? null;
  } catch (err) {
    logger.error({ err }, "Alpha Vantage fetch error");
    return null;
  }
}

/**
 * Fetch one pair: FMP first (fast), then AV if FMP fails
 */
async function fetchPairRate(fmpPair: string, avFrom: string, avTo: string, stale: string | null): Promise<string | null> {
  const fmpRate = await getForexRateFMP(fmpPair);
  if (fmpRate) return fmpRate;
  logger.info({ pair: fmpPair }, "FMP null — trying AV fallback");
  const avRate = await getForexRateAV(avFrom, avTo);
  return avRate ?? stale;
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const age = Date.now() - marketCacheTime;

  // Fresh cache — return immediately
  if (marketCache && age < MARKET_CACHE_TTL) {
    return marketCache;
  }

  const stale = marketCache ?? { EURUSD: null, GBPUSD: null, USDJPY: null, USDCHF: null, XAUUSD: null };

  // All pairs fetched in PARALLEL — FMP has no sequential rate-limit requirement
  const [EURUSD, GBPUSD, USDJPY, USDCHF, XAUUSD] = await Promise.all([
    fetchPairRate("EURUSD", "EUR", "USD", stale.EURUSD),
    fetchPairRate("GBPUSD", "GBP", "USD", stale.GBPUSD),
    fetchPairRate("USDJPY", "USD", "JPY", stale.USDJPY),
    fetchPairRate("USDCHF", "USD", "CHF", stale.USDCHF),
    fetchPairRate("XAUUSD", "XAU", "USD", stale.XAUUSD),
  ]);

  const result: MarketSnapshot = { EURUSD, GBPUSD, USDJPY, USDCHF, XAUUSD };
  const populated = Object.values(result).filter((v) => v !== null).length;

  if (populated > 0) {
    // Got at least some live data — update cache
    marketCache = result;
    marketCacheTime = Date.now();
    logger.info({ rates: Object.keys(result).filter((k) => result[k as keyof MarketSnapshot] !== null) }, "Market snapshot updated (parallel fetch)");
  } else if (marketCache && age < MARKET_STALE_TTL) {
    // All APIs failed but we have recent stale data — serve it to avoid blank prices
    logger.warn({ staleSecs: Math.round(age / 1000) }, "All price APIs failed — serving stale market cache");
    return marketCache;
  } else {
    // Nothing — update cache with nulls so we know we tried
    marketCache = result;
    marketCacheTime = Date.now();
    logger.warn("Market snapshot all null — no live price data available");
  }

  return result;
}
