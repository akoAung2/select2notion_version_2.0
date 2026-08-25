/**
 * Shared trade property mapping — Notion ↔ simplified format.
 * Used by routes/ai.ts, routes/telegram.ts, and routes/notion.ts.
 */

import { AI_EXCLUDED_TYPES } from "../aiEngine.js";

/* ─────────────────────────────────────────────────────────────
   NOTION PAGE → SIMPLIFIED FLAT RECORD
   Merges mapTradeForAI (aiEngine.ts) + mapNotionPageToTrade (notion.ts)
───────────────────────────────────────────────────────────── */

export function fromNotionPage(page: Record<string, unknown>): Record<string, unknown> {
  const properties = (page.properties as Record<string, unknown>) || {};
  const result: Record<string, unknown> = { id: page.id as string };

  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as Record<string, unknown>;
    const type = p.type as string;

    // Always extract files (URLs) even though they're excluded from AI context
    if (type === "files") {
      const files = (p.files || []) as Array<{ type: string; external?: { url: string }; file?: { url: string } }>;
      const urls = files
        .map((f) => (f.type === "external" ? f.external!.url : f.file?.url ?? ""))
        .filter(Boolean)
        .join(",");
      if (urls) result[key] = urls;
      continue;
    }

    if (AI_EXCLUDED_TYPES.has(type)) continue;

    if (type === "title") {
      result[key] = (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
    } else if (type === "rich_text") {
      result[key] = (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
    } else if (type === "select") {
      result[key] = (p.select as { name?: string })?.name ?? "";
    } else if (type === "multi_select") {
      result[key] = (p.multi_select as Array<{ name: string }>).map((t) => t.name).join(", ");
    } else if (type === "checkbox") {
      result[key] = (p.checkbox as boolean) ? "Yes" : "No";
    } else if (type === "number") {
      result[key] = p.number as number;
    } else if (type === "date") {
      result[key] = (p.date as { start?: string })?.start ?? "";
    } else if (type === "status") {
      result[key] = (p.status as { name?: string })?.name ?? "";
    } else if (type === "files") {
      const files = (p.files || []) as Array<{ type: string; external?: { url: string }; file?: { url: string } }>;
      result[key] = files
        .map((f) => (f.type === "external" ? f.external!.url : f.file!.url))
        .filter(Boolean)
        .join(",");
    } else if (type === "formula") {
      const f = p.formula as Record<string, unknown>;
      const ft = f.type as string;
      if (ft === "string") result[key] = f.string ?? "";
      else if (ft === "number") result[key] = f.number;
      else if (ft === "boolean") result[key] = (f.boolean as boolean) ? "Yes" : "No";
      else if (ft === "date") result[key] = (f.date as { start?: string })?.start ?? "";
    } else {
      result[key] = "";
    }
  }

  // Remove empty values (preserve numeric 0 — it's a valid P&L value for breakeven trades)
  for (const k of Object.keys(result)) {
    if (k === "id") continue;
    const v = result[k];
    if (v === "" || v === null || v === undefined) delete result[k];
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────
   SIMPLIFIED FLAT RECORD → NOTION API PROPERTIES
   Merges inline switch from ai.ts confirm-action + telegram.ts saveTradeToNotion
───────────────────────────────────────────────────────────── */

export function toNotionProperties(
  fields: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    const propSchema = schema[key] as Record<string, unknown> | undefined;
    if (!propSchema) continue;
    const type = propSchema.type as string;

    switch (type) {
      case "title":
        properties[key] = { title: [{ text: { content: String(value) } }] };
        break;
      case "rich_text":
        properties[key] = { rich_text: [{ text: { content: String(value) } }] };
        break;
      case "number":
        properties[key] = { number: Number(value) };
        break;
      case "select":
        properties[key] = { select: { name: String(value) } };
        break;
      case "multi_select": {
        const names = Array.isArray(value)
          ? (value as string[])
          : String(value).split(",").map((s) => s.trim());
        properties[key] = { multi_select: names.map((name) => ({ name })) };
        break;
      }
      case "checkbox":
        properties[key] = { checkbox: value === "Yes" || value === true || value === "true" };
        break;
      case "date":
        properties[key] = { date: { start: String(value) } };
        break;
      case "files": {
        const urls = Array.isArray(value)
          ? (value as string[])
          : String(value).split(",").map((s) => s.trim()).filter(Boolean);
        if (urls.length > 0) {
          properties[key] = {
            files: urls.slice(0, 5).map((url, i) => ({
              name: `Chart ${i + 1}`,
              type: "external",
              external: { url },
            })),
          };
        }
        break;
      }
      // url, email, phone_number, status etc. — store as rich_text fallback
      default:
        properties[key] = { rich_text: [{ text: { content: String(value) } }] };
        break;
    }
  }

  return properties;
}
