/**
 * NewsAPI Client
 * Fetches breaking financial news and market sentiment
 */

import { logger } from "../../lib/logger.js";

const BASE = "https://newsapi.org/v2";
const API_KEY = process.env.NEWS_API_KEY ?? "";

export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: { name: string };
  publishedAt: string;
  content: string | null;
}

async function newsFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!API_KEY) {
    logger.warn("NEWS_API_KEY not set");
    return null;
  }
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apiKey", API_KEY);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      logger.warn({ status: resp.status, path }, "NewsAPI error");
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    logger.error({ err, path }, "NewsAPI fetch error");
    return null;
  }
}

interface NewsResponse {
  status: string;
  totalResults: number;
  articles: NewsArticle[];
}

export async function getForexNews(): Promise<NewsArticle[]> {
  const resp = await newsFetch<NewsResponse>("/everything", {
    q: "USD forex Federal Reserve inflation economy",
    language: "en",
    sortBy: "publishedAt",
    pageSize: "10",
    domains: "reuters.com,bloomberg.com,cnbc.com,marketwatch.com,ft.com",
  });
  return resp?.articles ?? [];
}

export async function getBreakingBusinessNews(): Promise<NewsArticle[]> {
  const resp = await newsFetch<NewsResponse>("/top-headlines", {
    category: "business",
    language: "en",
    country: "us",
    pageSize: "10",
  });
  return resp?.articles ?? [];
}

export async function getNewsForEvent(eventName: string): Promise<NewsArticle[]> {
  const resp = await newsFetch<NewsResponse>("/everything", {
    q: `${eventName} USD economy`,
    language: "en",
    sortBy: "publishedAt",
    pageSize: "5",
    from: new Date(Date.now() - 24 * 3600_000).toISOString().split("T")[0],
  });
  return resp?.articles ?? [];
}
