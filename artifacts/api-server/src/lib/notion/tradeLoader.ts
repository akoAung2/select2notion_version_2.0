/**
 * Shared Notion trade loader with pagination.
 * Merges loadTrades (ai.ts) + loadTradesForBot (telegram.ts).
 */

import { Client } from "@notionhq/client";
import { normalizeDbId } from "../aiEngine.js";
import { logger } from "../logger.js";
import { fromNotionPage } from "./tradeMapper.js";
import type { NotionCredentials } from "./schemaLoader.js";

/** Retry helper for Notion API calls */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 800,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); } catch (err: unknown) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

export async function loadNotionTrades(
  creds: NotionCredentials,
  filter?: Record<string, unknown>,
  maxTrades = 500,
): Promise<Array<Record<string, unknown>>> {
  try {
    const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
    const dbId = normalizeDbId(creds.notion_database_id);

    let allResults: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        page_size: 100,
        sorts: [{ property: "Date", direction: "descending" }],
      };
      if (filter) body.filter = filter;
      if (cursor) body.start_cursor = cursor;

      const resp = await withRetry(
        () => notion.request({
          path: `databases/${dbId}/query`,
          method: "post",
          body,
        }) as Promise<{ results: Array<Record<string, unknown>>; has_more: boolean; next_cursor: string | null }>,
      );

      allResults = allResults.concat(resp.results);
      cursor = resp.has_more && resp.next_cursor ? resp.next_cursor : undefined;
    } while (cursor && allResults.length < maxTrades);

    return allResults.slice(0, maxTrades).map(fromNotionPage);
  } catch (err) {
    logger.error({ err, dbId: normalizeDbId(creds.notion_database_id) }, "Notion trade query failed after retries — returning empty");
    return []; // Graceful fallback: return empty to avoid crashing the chat session
  }
}
