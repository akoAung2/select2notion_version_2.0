/**
 * Telegram LogTrade wizard — step-by-step trade logging state machine.
 * Extracted from telegram.ts to reduce file size.
 *
 * All functions take `bot` as a parameter to avoid circular dependencies.
 */

import TelegramBot from "node-telegram-bot-api";
import { callAI, describeSchemaForAI, getUserAIConfigByAdmin, getNotionCredsByAdmin, type AIConfig } from "../../lib/aiEngine.js";
import { logger } from "../../lib/logger.js";
import { loadNotionSchema } from "../../lib/notion/schemaLoader.js";

/* ─────────────────────────────────────────────────────────────
   TYPES & STATE
───────────────────────────────────────────────────────────── */

export type LogTradeState =
  | "WAIT_INPUT"
  | "MISSING_FIELDS"
  | "FILLING"
  | "URL"
  | "URL_COLLECTING"
  | "PREVIEW"
  | "EDIT_FIELD";

export interface LogTradeSession {
  state: LogTradeState;
  fields: Record<string, string>;
  schema: Record<string, unknown>;
  missingFields: string[];
  skippedFields: Set<string>;
  editingField?: string;
  previewMsgId?: number;
  urlPropName?: string;
  collectedUrls: string[];
  saveLocked?: boolean;
  createdAt: number;
}

export const logTradeSessions = new Map<number, LogTradeSession>();

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */

export const NO_REWRITE_FIELDS = new Set([
  "journal", "emotion", "notes", "note", "commentary", "comment",
  "feeling", "mindset", "remark", "thoughts", "thought",
]);

const LT_ALIASES: Record<string, string> = {
  pdh: "Previous Day High", pdl: "Previous Day Low",
  pwh: "Previous Week High", pwl: "Previous Week Low",
  eqh: "Equal High", eql: "Equal Low",
  be: "Break Even", sl: "Stop Loss", tp: "Take Profit",
  rr: "Risk Reward", "r:r": "Risk Reward",
  ob: "Order Block", choch: "Change of Character",
  bos: "Break of Structure", fvg: "Fair Value Gap",
  ifvg: "Imbalance Fair Value Gap",
  cisd: "Change in State of Delivery",
  "ny session": "New York Session",
  "london session": "London Session",
  "asia session": "Asia Session",
};

const AUTO_PROP_TYPES = new Set([
  "created_time", "last_edited_time", "created_by", "last_edited_by",
  "formula", "rollup", "unique_id",
]);

const AUTO_NAME_RE = [/^date$/i, /^month$/i, /^year$/i, /^day.?of.?week$/i, /^created/i, /^last.?edited/i];

/* ─────────────────────────────────────────────────────────────
   PURE HELPERS (no side effects)
───────────────────────────────────────────────────────────── */

export function isAutoGenProp(name: string, prop: unknown): boolean {
  const type = (prop as Record<string, unknown>).type as string;
  if (AUTO_PROP_TYPES.has(type)) return true;
  return AUTO_NAME_RE.some((r) => r.test(name));
}

export function getMissingFields(schema: Record<string, unknown>, fields: Record<string, string>, skipped: Set<string>): string[] {
  return Object.keys(schema).filter((name) => {
    if (isAutoGenProp(name, schema[name])) return false;
    if (skipped.has(name)) return false;
    const v = fields[name];
    return !v || v.trim() === "";
  });
}

export function findUrlProperty(schema: Record<string, unknown>): string | undefined {
  const keywords = ["screenshot", "url", "image", "photo", "link", "chart", "picture"];
  for (const name of Object.keys(schema)) {
    const type = (schema[name] as Record<string, unknown>).type as string;
    const nl = name.toLowerCase();
    if ((type === "url" || type === "files" || type === "rich_text") && keywords.some((k) => nl.includes(k))) return name;
    if (keywords.some((k) => nl.includes(k))) return name;
  }
  return undefined;
}

export function buildTradePreviewText(fields: Record<string, string>, schema: Record<string, unknown>): string {
  const order = Object.keys(schema).filter((k) => !isAutoGenProp(k, schema[k]));
  const lines: string[] = [];
  for (const k of order) {
    const v = fields[k];
    if (v && v.trim()) lines.push(`• *${k}*: ${v}`);
  }
  for (const [k, v] of Object.entries(fields)) {
    if (!order.includes(k) && v && v.trim()) lines.push(`• *${k}*: ${v}`);
  }
  return lines.length > 0 ? lines.join("\n") : "_(no fields captured yet)_";
}

function isValidScreenshotUrl(url: string): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────
   UI HELPERS (send Telegram messages)
───────────────────────────────────────────────────────────── */

export async function showMissingFieldsPrompt(chatId: number, session: LogTradeSession, bot: TelegramBot): Promise<void> {
  if (session.missingFields.length === 0) { await advanceToUrl(chatId, session, bot); return; }
  session.state = "MISSING_FIELDS";
  const missingList = session.missingFields.map((m) => `• ${m}`).join("\n");
  await bot.sendMessage(chatId,
    `📊 *Captured so far:*\n${buildTradePreviewText(session.fields, session.schema)}\n\n❓ *Missing fields (${session.missingFields.length}):*\n${missingList}`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "✏️ Fill Missing", callback_data: "lt_fill" },
        { text: "⏭️ Skip All", callback_data: "lt_skip_missing" },
      ]] },
    },
  );
}

export async function advanceToUrl(chatId: number, session: LogTradeSession, bot: TelegramBot): Promise<void> {
  const urlProp = session.urlPropName;
  if (!urlProp) {
    await showFullPreview(chatId, session, bot);
    return;
  }
  session.state = "URL";
  await bot.sendMessage(chatId,
    `📎 *Add screenshot links?*\n_(saves to "${urlProp}" — up to 5 URLs)_`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "📎 Add Links", callback_data: "lt_addurl" },
        { text: "⏭️ Skip", callback_data: "lt_skipurl" },
      ]] },
    },
  );
}

export async function promptForNextUrl(chatId: number, session: LogTradeSession, bot: TelegramBot): Promise<void> {
  const count = session.collectedUrls.length;
  if (count >= 5) {
    await mergeUrlsAndPreview(chatId, session, bot);
    return;
  }
  session.state = "URL_COLLECTING";
  await bot.sendMessage(chatId,
    `🔗 *Paste screenshot URL ${count + 1}/5:*\n_(any https:// link — TradingView, Imgur, etc.)_`,
    { parse_mode: "Markdown" },
  );
}

export async function mergeUrlsAndPreview(chatId: number, session: LogTradeSession, bot: TelegramBot): Promise<void> {
  if (session.collectedUrls.length > 0 && session.urlPropName) {
    session.fields[session.urlPropName] = session.collectedUrls.join(",");
  }
  await showFullPreview(chatId, session, bot);
}

export async function showFullPreview(chatId: number, session: LogTradeSession, bot: TelegramBot, editMsgId?: number): Promise<void> {
  session.state = "PREVIEW";
  const previewText = `📋 *Trade Preview*\n\n${buildTradePreviewText(session.fields, session.schema)}\n\n_Confirm to save to Notion:_`;

  const editableFields = Object.keys(session.schema)
    .filter((k) => !isAutoGenProp(k, session.schema[k]))
    .filter((k) => session.fields[k] && session.fields[k].trim());

  const editRows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < editableFields.length; i += 2) {
    const row = editableFields.slice(i, i + 2).map((f) => ({
      text: `✏️ ${f}`,
      callback_data: `le:${f}`.slice(0, 64),
    }));
    editRows.push(row);
  }

  const keyboard = [
    [{ text: "✅ Save", callback_data: "lt_save" }, { text: "❌ Cancel", callback_data: "lt_cancel" }],
    ...editRows,
  ];

  const opts = { parse_mode: "Markdown" as const, reply_markup: { inline_keyboard: keyboard } };

  if (editMsgId) {
    await bot.editMessageText(previewText, { chat_id: chatId, message_id: editMsgId, ...opts }).catch(() => {});
    session.previewMsgId = editMsgId;
  } else {
    const m = await bot.sendMessage(chatId, previewText, opts);
    session.previewMsgId = m.message_id;
  }
}

/* ─────────────────────────────────────────────────────────────
   LOGTRADE ENTRY POINT
───────────────────────────────────────────────────────────── */

export async function handleLogTrade(bot: TelegramBot, chatId: number, getUidForChat: (cid: number) => Promise<string | null>): Promise<void> {
  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }

  const creds = await getNotionCredsByAdmin(uid).catch(() => null);
  if (!creds) { await bot.sendMessage(chatId, "❌ Notion not connected. Set it up on the website first."); return; }

  const schema = await loadNotionSchema(uid, creds);
  if (!schema) { await bot.sendMessage(chatId, "❌ Could not load schema. Try /refresh first."); return; }

  const urlPropName = findUrlProperty(schema);
  logTradeSessions.set(chatId, {
    state: "WAIT_INPUT",
    fields: {},
    schema,
    missingFields: [],
    skippedFields: new Set(),
    urlPropName,
    collectedUrls: [],
    createdAt: Date.now(),
  });

  const propNames = Object.keys(schema)
    .filter((k) => !isAutoGenProp(k, schema[k]))
    .slice(0, 12).join(", ");

  await bot.sendMessage(chatId,
    `📝 *Trade Logging Mode Active*\n\nDescribe your trade in text or voice — any language.\n\n*I'll extract:* ${propNames}${Object.keys(schema).filter((k) => !isAutoGenProp(k, schema[k])).length > 12 ? " …" : ""}\n\nSend /cancel anytime to exit.`,
    { parse_mode: "Markdown" },
  );
}

/* ─────────────────────────────────────────────────────────────
   TRADE FIELD EXTRACTION (AI)
───────────────────────────────────────────────────────────── */

export async function extractTradeFields(
  config: AIConfig,
  schema: Record<string, unknown>,
  userText: string,
  existingFields: Record<string, string>,
): Promise<{ fields: Record<string, string>; missing: string[]; reply: string }> {
  const today = new Date().toISOString().split("T")[0];
  const noRewriteProps = Object.keys(schema).filter((k) => NO_REWRITE_FIELDS.has(k.toLowerCase())).join(", ");
  const schemaDesc = describeSchemaForAI(schema);
  const aliasList = Object.entries(LT_ALIASES).map(([k, v]) => `${k}→${v}`).join(", ");
  const existing = Object.keys(existingFields).length > 0
    ? `\nAlready captured (merge, don't overwrite unless new data corrects): ${JSON.stringify(existingFields)}`
    : "";

  const prompt = `You are a precise trade data extractor for a Notion trading journal.

Database schema:
${schemaDesc}

Today: ${today}${existing}

Alias dictionary (expand these abbreviations): ${aliasList}

STRICT RULES:
1. Use EXACT property names from schema.
2. Expand abbreviations using alias dictionary before mapping.
3. For date fields → use today (${today}) unless user specifies otherwise.
4. For select/multi_select → match closest existing option from schema.
5. For number fields → numeric value only (no units).
6. CRITICAL NO-REWRITE FIELDS [${noRewriteProps || "journal, emotion, notes"}]: Store user's EXACT original words verbatim. Never translate, summarize, paraphrase, or improve grammar.
7. Only extract clearly stated information. Do not guess.
8. List missing schema properties (excluding auto-generated ones like date, created_time, etc.).

Return ONLY valid JSON (no markdown fences):
{"fields":{"PropertyName":"value"},"missing":["PropertyName1"],"reply":"Short acknowledgment in user's language"}`;

  const raw = await callAI(config, prompt, [{ role: "user", content: userText }], { temperature: 0.1 });

  try {
    // Handle JSON wrapped in markdown fences (```json ... ```) or bare
    let cleaned = raw;
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Validate extracted fields exist in schema — warn about hallucinations
      const unknownFields = Object.keys(parsed.fields ?? {}).filter((k) => !(k in schema));
      if (unknownFields.length > 0) {
        logger.warn({ unknownFields, schemaKeys: Object.keys(schema).slice(0, 20) }, "AI returned fields not in schema — dropping them");
        for (const k of unknownFields) delete parsed.fields[k];
      }
      return {
        fields: parsed.fields ?? {},
        missing: (parsed.missing ?? []).filter((m: string) => {
          const p = schema[m];
          return !p || !isAutoGenProp(m, p);
        }),
        reply: parsed.reply ?? "Got it!",
      };
    }
  } catch (err) {
    logger.error({ err, raw: raw.slice(0, 300), userText: userText.slice(0, 200) }, "Failed to parse AI trade extraction JSON");
  }

  return { fields: {}, missing: [], reply: "Understood." };
}

/* ─────────────────────────────────────────────────────────────
   MAIN INPUT PROCESSOR
───────────────────────────────────────────────────────────── */

/** Retry helper — local copy with non-retryable error detection */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 600,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Don't retry authentication or key errors — those won't resolve with retries
      if (msg === "invalid_key" || msg.startsWith("auth_error:") || msg.startsWith("model_not_found")) throw err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

export async function processLogTradeInput(
  chatId: number,
  uid: string,
  userText: string,
  bot: TelegramBot,
  session: LogTradeSession,
): Promise<void> {
  // ── EDIT_FIELD ──
  if (session.state === "EDIT_FIELD") {
    const field = session.editingField!;
    session.fields[field] = userText.trim();
    session.editingField = undefined;
    session.state = "PREVIEW";
    await bot.sendMessage(chatId, `✅ *${field}* updated.`, { parse_mode: "Markdown" });
    await showFullPreview(chatId, session, bot, session.previewMsgId);
    return;
  }

  // ── URL_COLLECTING ──
  if (session.state === "URL_COLLECTING") {
    const url = userText.trim();
    if (!isValidScreenshotUrl(url)) {
      await bot.sendMessage(chatId, `❌ That doesn't look like a valid URL. Please paste a link starting with https:// (or http://).`);
      return;
    }
    session.collectedUrls.push(url);
    const count = session.collectedUrls.length;
    if (count >= 5) {
      await bot.sendMessage(chatId, `✅ URL ${count} saved! Maximum 5 reached.`);
      await mergeUrlsAndPreview(chatId, session, bot);
    } else {
      await bot.sendMessage(chatId,
        `✅ URL ${count} saved!\n_${url}_\n\nAdd another? (${count}/5)`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[
            { text: "➕ Add Another", callback_data: "lt_url_more" },
            { text: "✅ Done", callback_data: "lt_url_done" },
          ]] },
        },
      );
    }
    return;
  }

  // ── WAIT_INPUT / FILLING: extract fields via AI ──
  const config = await getUserAIConfigByAdmin(uid).catch(() => null);
  if (!config) {
    await bot.sendMessage(chatId, "⚙️ No AI provider configured. Add one in Settings on the website.");
    return;
  }

  await bot.sendChatAction(chatId, "typing").catch(() => {});

  let extracted: { fields: Record<string, string>; missing: string[]; reply: string };
  try {
    extracted = await withRetry(
      () => extractTradeFields(config, session.schema, userText, session.fields),
    );
  } catch {
    await bot.sendMessage(chatId, "❌ AI extraction failed. Please rephrase and try again.");
    return;
  }

  // Merge into session — never overwrite existing no-rewrite fields
  for (const [k, v] of Object.entries(extracted.fields)) {
    const trimmed = String(v).trim();
    if (!trimmed) continue;
    // Skip fields that don't exist in the schema (AI hallucination guard)
    if (!(k in session.schema)) {
      logger.warn({ field: k, schemaKeys: Object.keys(session.schema).slice(0, 20) }, "AI returned field not in schema, skipping");
      continue;
    }
    if (NO_REWRITE_FIELDS.has(k.toLowerCase()) && session.fields[k]) continue;
    session.fields[k] = trimmed;
    session.missingFields = session.missingFields.filter((m) => m !== k);
  }

  if (Object.keys(session.fields).length === 0) {
    await bot.sendMessage(chatId,
      "❓ Couldn't detect trade fields. Try describing:\n• Market (Nasdaq, EURUSD…)\n• Profit/Loss amount\n• Entry type (CISD, OB…)\n• Session (New York, London…)\n• How you felt",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const missing = getMissingFields(session.schema, session.fields, session.skippedFields);
  session.missingFields = missing;

  await bot.sendMessage(chatId, extracted.reply).catch(() => {});

  if (missing.length > 0) {
    await showMissingFieldsPrompt(chatId, session, bot);
  } else {
    await advanceToUrl(chatId, session, bot);
  }
}
