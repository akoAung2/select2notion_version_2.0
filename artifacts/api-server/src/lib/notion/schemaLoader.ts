/**
 * Shared Notion schema loader with cache.
 * Merges loadSchema (ai.ts) + loadSchemaForBot (telegram.ts).
 * Both callers pass in already-resolved credentials.
 */

import { Client } from "@notionhq/client";
import { normalizeDbId } from "../aiEngine.js";
import { getCachedSchema, setCachedSchema } from "../schemaCache.js";
import { logger } from "../logger.js";

export interface NotionCredentials {
  notion_token: string;
  notion_database_id: string;
}

export async function loadNotionSchema(
  uid: string,
  creds: NotionCredentials,
): Promise<Record<string, unknown> | null> {
  const cached = getCachedSchema(uid);
  if (cached) return cached;

  try {
    const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
    const db = await notion.databases.retrieve({
      database_id: normalizeDbId(creds.notion_database_id),
    }) as Record<string, unknown>;
    const schema = db.properties as Record<string, unknown>;
    setCachedSchema(uid, schema);
    return schema;
  } catch (err) {
    logger.warn({ err, uid }, "loadNotionSchema failed");
    return null;
  }
}
