/**
 * Telegram Bot + API Routes
 * Uses the same AI engine as routes/ai.ts — shared via lib/aiEngine.ts
 */

import crypto from "crypto";
import { Router } from "express";
import TelegramBot from "node-telegram-bot-api";
import { Client } from "@notionhq/client";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";
import { getCachedSchema, setCachedSchema, clearCachedSchema } from "../lib/schemaCache.js";
import {
  callAI, streamAI, classifyIntent, describeSchemaForAI, normalizeDbId,
  fetchGeminiModels, OPENAI_MODELS, transcribeAudio, ALLOWED_AUDIO_MIME_TYPES,
  getUserAIConfigByAdmin, getNotionCredsByAdmin, saveModelPreferenceByAdmin,
  type AIConfig, type NotionAdminCredentials,
} from "../lib/aiEngine.js";
import { calculateStats, formatStatsForPrompt } from "../lib/analysisEngine.js";
import { loadNotionSchema } from "../lib/notion/schemaLoader.js";
import { loadNotionTrades } from "../lib/notion/tradeLoader.js";
import { toNotionProperties } from "../lib/notion/tradeMapper.js";
import { buildPropertyDefinition } from "../lib/notion/propertyConfig.js";
import {
  logTradeSessions, type LogTradeSession, NO_REWRITE_FIELDS,
  handleLogTrade as handleLogTradeWizard,
  processLogTradeInput, extractTradeFields,
  buildTradePreviewText, showFullPreview, isAutoGenProp,
  advanceToUrl, promptForNextUrl, mergeUrlsAndPreview,
} from "./telegram/logTrade.js";
import { recordWebhookUpdate } from "./wakeup.js";

const router = Router();

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

/* ─────────────────────────────────────────────────────────────
   BOT STATE
───────────────────────────────────────────────────────────── */

let bot: TelegramBot | null = null;
let BOT_USERNAME = "";

interface PendingAction {
  type: "save_trade" | "create_property" | "rename_property";
  summary: Record<string, string>;
  data: Record<string, unknown>;
}

const conversations = new Map<number, { messages: Array<{ role: string; content: string }>; lastActivity: number }>();
const pendingActions = new Map<number, { action: PendingAction; createdAt: number }>();
const pendingDisconnect = new Map<number, number>(); // chatId → timestamp
const pendingVoice = new Map<number, { transcript: string; msgId: number; createdAt: number }>();

// TTL constants for short-lived interaction state
const PENDING_ACTION_TTL = 15 * 60 * 1000;   // 15 min
const PENDING_VOICE_TTL  = 10 * 60 * 1000;   // 10 min
const PENDING_DISC_TTL   =  5 * 60 * 1000;   //  5 min
const LOG_TRADE_TTL      = 30 * 60 * 1000;   // 30 min

// ─── UID cache: avoids a Firestore query on every message ─────────────────
// chatId → { uid, expiresAt } — 5-minute TTL, invalidated on disconnect/link
const UID_CACHE_TTL = 5 * 60 * 1000;
const uidCache = new Map<number, { uid: string; expiresAt: number }>();

function invalidateUidCache(chatId: number): void {
  uidCache.delete(chatId);
}

// TTL cleanup: purge stale in-memory state every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [chatId, entry] of conversations) {
    if (now - entry.lastActivity > 60 * 60 * 1000) conversations.delete(chatId);
  }
  for (const [chatId, entry] of pendingActions) {
    if (now - entry.createdAt > PENDING_ACTION_TTL) pendingActions.delete(chatId);
  }
  for (const [chatId, entry] of pendingVoice) {
    if (now - entry.createdAt > PENDING_VOICE_TTL) pendingVoice.delete(chatId);
  }
  for (const [chatId, ts] of pendingDisconnect) {
    if (now - ts > PENDING_DISC_TTL) pendingDisconnect.delete(chatId);
  }
  for (const [chatId, session] of logTradeSessions) {
    if (now - session.createdAt > LOG_TRADE_TTL) logTradeSessions.delete(chatId);
  }
  for (const [chatId, entry] of uidCache) {
    if (now > entry.expiresAt) uidCache.delete(chatId);
  }
}, 5 * 60 * 1000);


/* ── Voice retry helper ── */
async function withVoiceRetry<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number) => Promise<void>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < maxAttempts) await onRetry(i);
    }
  }
  throw lastErr;
}

function getHistory(chatId: number): Array<{ role: string; content: string }> {
  if (!conversations.has(chatId)) conversations.set(chatId, { messages: [], lastActivity: Date.now() });
  const entry = conversations.get(chatId)!;
  entry.lastActivity = Date.now();
  return entry.messages;
}

function addHistory(chatId: number, role: string, content: string): void {
  const hist = getHistory(chatId);
  hist.push({ role, content });
  if (hist.length > 20) hist.splice(0, hist.length - 20);
}

/**
 * Stream an AI response into a Telegram message via incremental edits.
 * - If existingMsgId is provided, edits that message in-place.
 * - Otherwise sends a placeholder and edits it as tokens arrive.
 * - Throttles edits to ≤1/sec to respect Telegram rate limits.
 * - Falls back to callAI if streaming fails before any text is received.
 * Returns the full accumulated response text.
 */
async function streamToTelegram(
  bot: TelegramBot,
  chatId: number,
  config: AIConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    existingMsgId?: number;
    wrapText?: (text: string) => string;
  } = {},
): Promise<string> {
  const { existingMsgId, wrapText, ...aiOptions } = options;

  let msgId: number;
  if (existingMsgId) {
    msgId = existingMsgId;
  } else {
    const ph = await bot.sendMessage(chatId, "⏳", {}).catch(() => null);
    if (!ph) return callAI(config, systemPrompt, messages, aiOptions);
    msgId = ph.message_id;
  }

  let accumulated = "";
  let lastEditAt = 0;

  const tryEdit = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEditAt < 900) return;
    const text = accumulated.trim();
    if (!text) return;
    const displayText = wrapText ? wrapText(text) : text;
    const ok = await bot.editMessageText(displayText, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: "Markdown",
    }).then(() => true).catch(() => false);
    // Markdown parse error — retry as plain text so the user always sees output
    if (!ok) {
      await bot.editMessageText(displayText, {
        chat_id: chatId,
        message_id: msgId,
      }).catch(() => {});
    }
    lastEditAt = now;
  };

  try {
    for await (const chunk of streamAI(config, systemPrompt, messages, aiOptions)) {
      accumulated += chunk;
      await tryEdit();
    }
  } catch {
    if (!accumulated.trim()) {
      accumulated = await callAI(config, systemPrompt, messages, aiOptions);
    }
  }

  await tryEdit(true);
  return accumulated.trim();
}

function makeToken(length = 32): string {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

/* ─────────────────────────────────────────────────────────────
   FIRESTORE HELPERS
───────────────────────────────────────────────────────────── */

async function getUidForChat(chatId: number): Promise<string | null> {
  // Fast path: return cached uid (avoids Firestore round-trip on every message)
  const cached = uidCache.get(chatId);
  if (cached && Date.now() < cached.expiresAt) return cached.uid;

  if (!isAdminReady()) return null;
  try {
    const snap = await getAdminDb().collection("telegram_connections").where("chatId", "==", chatId).limit(1).get();
    const uid = snap.empty ? null : snap.docs[0].id;
    if (uid) uidCache.set(chatId, { uid, expiresAt: Date.now() + UID_CACHE_TTL });
    return uid;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   NOTION HELPERS (via Admin SDK — no idToken)
───────────────────────────────────────────────────────────── */

async function loadSchemaForBot(uid: string, creds: NotionAdminCredentials): Promise<Record<string, unknown> | null> {
  return loadNotionSchema(uid, creds);
}

async function loadTradesForBot(
  creds: NotionAdminCredentials,
  filter?: Record<string, unknown>,
  maxTrades = 500,
): Promise<Array<Record<string, unknown>>> {
  return loadNotionTrades(creds, filter, maxTrades);
}

async function saveTradeToNotion(
  creds: NotionAdminCredentials,
  properties: Record<string, unknown>,
  schema: Record<string, unknown>,
): Promise<string> {
  const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
  const dbId = normalizeDbId(creds.notion_database_id);

  const notionProps = toNotionProperties(properties, schema);

  const resp = await notion.pages.create({
    parent: { database_id: dbId } as Parameters<typeof notion.pages.create>[0]["parent"],
    properties: notionProps as Parameters<typeof notion.pages.create>[0]["properties"],
  }) as Record<string, unknown>;

  return resp.id as string;
}

/* ─────────────────────────────────────────────────────────────
   FULL AI PIPELINE (same engine as routes/ai.ts)
───────────────────────────────────────────────────────────── */

async function processMessage(chatId: number, uid: string, userText: string, bot: TelegramBot): Promise<void> {
  // Fire typing indicator immediately — before any awaits — so user sees feedback within ~100ms
  bot.sendChatAction(chatId, "typing").catch(() => {});

  // Parallel-load config + creds — saves ~300-600ms vs sequential Firestore reads
  const [config, creds] = await Promise.all([
    getUserAIConfigByAdmin(uid).catch(() => null),
    getNotionCredsByAdmin(uid).catch(() => null),
  ]);

  if (!config) {
    await bot.sendMessage(chatId, "⚙️ No AI provider configured. Go to Settings → AI Provider on the website.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  addHistory(chatId, "user", userText);
  const history = getHistory(chatId);

  try {
    const intent = await classifyIntent(config, userText);

    /* ── GENERAL CHAT ── */
    if (intent === "general_chat") {
      const systemPrompt = `You are an expert AI trading coach. Help with trading concepts, psychology, risk, and strategy.
Respond in the SAME LANGUAGE as the user. Keep responses concise for Telegram. Today: ${today}`;
      const reply = await streamToTelegram(bot, chatId, config, systemPrompt, history);
      addHistory(chatId, "assistant", reply);
      return;
    }

    /* ── REQUIRE NOTION ── */
    if (!creds) {
      await bot.sendMessage(chatId, "❌ Notion database not connected. Set it up on the website first.");
      return;
    }

    /* ── TRADE LOGGER ── */
    if (intent === "trade_logger") {
      const schema = await loadSchemaForBot(uid, creds);
      if (!schema) {
        await bot.sendMessage(chatId, "❌ Could not load your Notion schema. Try /refresh");
        return;
      }

      const schemaDesc = describeSchemaForAI(schema);
      const extractPrompt = `You are a trade data extractor for a Notion trading journal.
Database schema:
${schemaDesc}
Today: ${today}
Extract trade data from this message. Use EXACT property names from the schema.
Rules: For date → use today (${today}) if not specified. For select → closest option. For number → numeric only.
Return ONLY JSON: {"summary":{"Field":"value",...},"properties":{"Field":value,...},"reply":"Brief confirmation in user's language","confidence":"high"|"medium"|"low"}`;

      const raw = await callAI(config, extractPrompt, [{ role: "user", content: userText }], { temperature: 0.2 });
      let extracted: { summary?: Record<string, unknown>; properties?: Record<string, unknown>; reply?: string; confidence?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) extracted = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!extracted.properties || Object.keys(extracted.properties).length === 0 || extracted.confidence === "low") {
        const reply = await callAI(config, "You are a trading assistant. The trade details are unclear. Ask for clarification in the user's language.", history);
        addHistory(chatId, "assistant", reply.trim());
        await bot.sendMessage(chatId, reply.trim());
        return;
      }

      const summaryLines = Object.entries(extracted.summary ?? {})
        .map(([k, v]) => `• *${k}*: ${v}`)
        .join("\n");

      const action: PendingAction = {
        type: "save_trade",
        summary: extracted.summary as Record<string, string> ?? {},
        data: { properties: extracted.properties, schemaSnapshot: schema },
      };
      pendingActions.set(chatId, { action, createdAt: Date.now() });

      const confirmMsg = `📋 *Trade Ready to Save*\n\n${summaryLines}\n\n${extracted.reply ?? "Confirm to save?"}`;
      await bot.sendMessage(chatId, confirmMsg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Save Trade", callback_data: "confirm_action" },
            { text: "❌ Cancel", callback_data: "cancel_action" },
          ]],
        },
      });
      return;
    }

    /* ── ANALYSIS INTENTS ── */
    if (["ask_database", "weekly_review", "pattern_analysis", "emotion_analysis"].includes(intent)) {
      let filter: Record<string, unknown> | undefined;
      let periodLabel = "all time";

      if (intent === "weekly_review") {
        const ago = new Date();
        ago.setDate(ago.getDate() - 7);
        filter = { property: "Date", date: { on_or_after: ago.toISOString().split("T")[0] } };
        periodLabel = "last 7 days";
      }

      const [schema, trades] = await Promise.all([
        loadSchemaForBot(uid, creds),
        loadTradesForBot(creds, filter, 300),
      ]);

      if (trades.length === 0) {
        const reply = await callAI(config, `You are a trading coach. No trades found${intent === "weekly_review" ? " this week" : ""}. Respond in user's language.`, history);
        addHistory(chatId, "assistant", reply.trim());
        await bot.sendMessage(chatId, reply.trim());
        return;
      }

      const stats = calculateStats(trades as Record<string, string | number | null | undefined>[], schema ?? {});
      const statsText = formatStatsForPrompt(stats, `STATS — ${periodLabel.toUpperCase()}`);

      let systemPrompt: string;
      if (intent === "pattern_analysis") {
        systemPrompt = `You are a trading pattern analyst. ${statsText}\nSample trades (${Math.min(trades.length, 30)}): ${JSON.stringify(trades.slice(0, 30), null, 0)}\nToday: ${today}\nIdentify patterns in the stats. Which sessions/setups/pairs work best? What should the trader avoid? DO NOT recalculate P&L. Reply concisely for Telegram. Respond in user's language.`;
      } else if (intent === "emotion_analysis") {
        systemPrompt = `You are a trading psychology analyst. ${statsText}\nSample trades (${Math.min(trades.length, 30)}): ${JSON.stringify(trades.slice(0, 30), null, 0)}\nToday: ${today}\nAnalyze emotional patterns. Which mindsets produce best results? What psychological improvements are needed? DO NOT recalculate P&L. Reply concisely for Telegram. Respond in user's language.`;
      } else if (intent === "weekly_review") {
        systemPrompt = `You are a trading coach doing a weekly review. ${statsText}\nAll ${trades.length} trades this week: ${JSON.stringify(trades.slice(0, 40), null, 0)}\nToday: ${today}\nGive a structured weekly review: performance summary, best/worst aspects, key patterns, 3 improvements for next week. DO NOT recalculate P&L. Concise for Telegram. Respond in user's language.`;
      } else {
        systemPrompt = `You are an expert AI trading analyst. ${statsText}\n${trades.length} trades: ${JSON.stringify(trades.slice(0, 40), null, 0)}\nToday: ${today}\nAnswer the question using the data above. Be specific. DO NOT recalculate P&L. Respond in user's language.`;
      }

      const reply = await streamToTelegram(bot, chatId, config, systemPrompt, history, { maxOutputTokens: 1500 });
      addHistory(chatId, "assistant", reply);
      // Telegram 4096-char limit — split only if the streamed result is very long
      if (reply.length > 4000) {
        const chunks = reply.match(/.{1,4000}/gs) ?? [reply];
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk).catch(() => {});
        }
      }
      return;
    }

    /* ── PROPERTY CREATOR ── */
    if (intent === "property_creator") {
      const schema = await loadSchemaForBot(uid, creds);
      const existingNames = schema ? Object.keys(schema) : [];

      const parsePrompt = `You are a Notion database manager. Parse the request to create a property.
Existing: ${existingNames.join(", ")}
Supported types: title, rich_text, number, select, multi_select, checkbox, date, url
Message: "${userText}"
Return ONLY JSON: {"name":"Name","propertyType":"type","reply":"Confirmation in user's language"}`;

      const raw = await callAI(config, parsePrompt, [{ role: "user", content: userText }], { temperature: 0.1 });
      let parsed: { name?: string; propertyType?: string; reply?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!parsed.name || !parsed.propertyType) {
        const reply = await callAI(config, "Trading journal assistant. Respond in user's language.", history);
        addHistory(chatId, "assistant", reply.trim());
        await bot.sendMessage(chatId, reply.trim());
        return;
      }

      const action: PendingAction = {
        type: "create_property",
        summary: { Name: parsed.name, Type: parsed.propertyType },
        data: { name: parsed.name, propertyType: parsed.propertyType },
      };
      pendingActions.set(chatId, { action, createdAt: Date.now() });

      await bot.sendMessage(chatId,
        `🔧 *Create Property*\n\n• *Name*: ${parsed.name}\n• *Type*: ${parsed.propertyType}\n\n${parsed.reply ?? "Confirm?"}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Create", callback_data: "confirm_action" },
              { text: "❌ Cancel", callback_data: "cancel_action" },
            ]],
          },
        },
      );
      return;
    }

    /* ── PROPERTY EDITOR ── */
    if (intent === "property_editor") {
      const schema = await loadSchemaForBot(uid, creds);
      const existingNames = schema ? Object.keys(schema) : [];

      const parsePrompt = `You are a Notion database manager. Parse the request to rename a property.
Existing: ${existingNames.join(", ")}
Message: "${userText}"
Return ONLY JSON: {"oldName":"exact name","newName":"new name","reply":"Confirmation in user's language"}`;

      const raw = await callAI(config, parsePrompt, [{ role: "user", content: userText }], { temperature: 0.1 });
      let parsed: { oldName?: string; newName?: string; reply?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!parsed.oldName || !parsed.newName) {
        const reply = await callAI(config, "Trading journal assistant. Respond in user's language.", history);
        addHistory(chatId, "assistant", reply.trim());
        await bot.sendMessage(chatId, reply.trim());
        return;
      }

      const action: PendingAction = {
        type: "rename_property",
        summary: { "Old Name": parsed.oldName, "New Name": parsed.newName },
        data: { oldName: parsed.oldName, newName: parsed.newName },
      };
      pendingActions.set(chatId, { action, createdAt: Date.now() });

      await bot.sendMessage(chatId,
        `✏️ *Rename Property*\n\n• *From*: ${parsed.oldName}\n• *To*: ${parsed.newName}\n\n${parsed.reply ?? "Confirm?"}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Rename", callback_data: "confirm_action" },
              { text: "❌ Cancel", callback_data: "cancel_action" },
            ]],
          },
        },
      );
      return;
    }

    /* ── FALLBACK ── */
    const reply = await callAI(config, "You are an expert AI trading coach. Respond in the user's language. Keep it concise for Telegram.", history);
    addHistory(chatId, "assistant", reply.trim());
    await bot.sendMessage(chatId, reply.trim(), { parse_mode: "Markdown" }).catch(() => bot.sendMessage(chatId, reply.trim()));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, uid, chatId }, "Telegram AI pipeline error");
    if (msg === "invalid_key") {
      await bot.sendMessage(chatId, "❌ AI API key is invalid. Update it in Settings → AI Provider on the website.");
    } else if (msg.startsWith("rate_limited") || msg.startsWith("OPENAI_RATE_LIMIT") || msg.startsWith("GEMINI_RATE_LIMIT")) {
      await bot.sendMessage(chatId, "⏳ AI rate limit hit. Please wait a moment and try again.");
    } else if (msg.includes("timeout")) {
      await bot.sendMessage(chatId, "⏰ AI response timed out. Please try again.");
    } else {
      await bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   COMMAND HANDLERS
───────────────────────────────────────────────────────────── */

async function handleStart(bot: TelegramBot, chatId: number, from: TelegramBot.User, token?: string): Promise<void> {
  if (!isAdminReady()) {
    await bot.sendMessage(chatId, "⚠️ Bot not fully configured. Try again later.");
    return;
  }

  if (token) {
    try {
      const db = getAdminDb();
      const linkSnap = await db.collection("telegram_link_requests").doc(token).get();
      if (!linkSnap.exists) {
        await bot.sendMessage(chatId, "❌ Link token is invalid or expired. Generate a new one from the website.");
        return;
      }
      const linkData = linkSnap.data()!;
      if (Date.now() > (linkData.expiresAt as number)) {
        await db.collection("telegram_link_requests").doc(token).delete();
        await bot.sendMessage(chatId, "⏰ Link has expired. Generate a new one from Settings.");
        return;
      }
      const uid = linkData.uid as string;
      await db.collection("telegram_connections").doc(uid).set({
        telegramUserId: from.id,
        telegramUsername: from.username ?? "",
        telegramFirstName: from.first_name ?? "",
        chatId,
        uid,   // store uid in data so legacy readers don't break
        connectedAt: FieldValue.serverTimestamp(),
      });
      await db.collection("telegram_link_requests").doc(token).delete();
      logger.info({ uid, telegramUserId: from.id }, "Telegram account linked");
      await bot.sendMessage(chatId,
        `✅ *Account Connected!*\n\nYour Select2Notion account is now linked.\n\nType /help to see what I can do, or just start chatting!`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      logger.error({ err }, "Telegram link error");
      await bot.sendMessage(chatId, "❌ Something went wrong. Please try again from the website.");
    }
    return;
  }

  const uid = await getUidForChat(chatId);
  if (!uid) {
    await bot.sendMessage(chatId,
      `👋 *Welcome to Select2Notion AI Agent!*\n\nTo connect your account:\n1. Go to the website\n2. Settings → Telegram Bot\n3. Click "Connect via Telegram"`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  const [aiConfig, creds] = await Promise.all([
    getUserAIConfigByAdmin(uid).catch(() => null),
    getNotionCredsByAdmin(uid).catch(() => null),
  ]);

  await bot.sendMessage(chatId,
    `🤖 *Select2Notion AI Agent*\n\n` +
    `📊 Notion: ${creds ? "✅ Connected" : "❌ Not connected"}\n` +
    `🧠 AI: ${aiConfig ? `✅ ${aiConfig.provider} / ${aiConfig.model}` : "❌ Not configured"}\n\n` +
    `Just send me a message to chat with your AI trading agent!\n\n` +
    `Type /help for all commands.`,
    { parse_mode: "Markdown" },
  );
}

async function handleHelp(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(chatId,
    `🤖 *Select2Notion AI Agent — Commands*\n\n` +
    `*Chat Commands:*\n` +
    `Just type or send a voice message to chat!\n\n` +
    `*Bot Commands:*\n` +
    `/start — welcome & status\n` +
    `/help — this help\n` +
    `/logtrade — 📝 dedicated trade logging mode\n` +
    `/coach — 🏋️ weekly coaching summary\n` +
    `/review — 📅 weekly performance review\n` +
    `/pattern — 🔍 pattern & setup analysis\n` +
    `/askdb <question> — 💬 query your trade data\n` +
    `/refresh — 🔄 Smart Refresh 2.0\n` +
    `/status — detailed connection info\n` +
    `/health — full system health check\n` +
    `/model — view & switch AI model\n` +
    `/apihealth — test AI connectivity\n` +
    `/disconnect — unlink account\n\n` +
    `*What I can do:*\n` +
    `🎤 Voice message support (OGG/MP3/WAV/M4A)\n` +
    `📝 Log trades — text or voice, any language\n` +
    `📊 Analyze your performance stats\n` +
    `📅 Weekly performance reviews\n` +
    `🔍 Pattern & emotion analysis\n` +
    `🔧 Create/rename database properties`,
    { parse_mode: "Markdown" },
  );
}

async function handleStatus(bot: TelegramBot, chatId: number, from: TelegramBot.User): Promise<void> {
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const uid = await getUidForChat(chatId);
  if (!uid) {
    await bot.sendMessage(chatId, "❌ No account linked. Go to Settings → Telegram Bot on the website.");
    return;
  }

  const [aiConfig, creds, connSnap] = await Promise.all([
    getUserAIConfigByAdmin(uid).catch(() => null),
    getNotionCredsByAdmin(uid).catch(() => null),
    getAdminDb().collection("telegram_connections").doc(uid).get().catch(() => null),
  ]);

  const connData = connSnap?.data() ?? {};
  const connectedAt = connData.connectedAt?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) ?? "Unknown";
  const schema = getCachedSchema(uid);

  await bot.sendMessage(chatId,
    `📊 *Account Status*\n\n` +
    `👤 Telegram: @${from.username ?? from.first_name}\n` +
    `📅 Connected: ${connectedAt}\n` +
    `📁 Notion: ${creds ? "✅ Connected" : "❌ Not connected"}\n` +
    `🧠 AI: ${aiConfig ? `✅ ${aiConfig.provider}` : "❌ Not configured"}\n` +
    `🔧 Model: ${aiConfig?.model ?? "—"}\n` +
    `📋 Schema: ${schema ? `✅ Cached (${Object.keys(schema).length} props)` : "⏳ Not loaded"}`,
    { parse_mode: "Markdown" },
  );
}

async function handleHealth(bot: TelegramBot, chatId: number): Promise<void> {
  const uid = await getUidForChat(chatId);
  const statusMsg = await bot.sendMessage(chatId, "🔍 Running full health check…");

  const results: string[] = [];

  // 1. Telegram
  results.push(`✅ Telegram: Connected`);

  // 2. Firebase Admin
  results.push(isAdminReady() ? `✅ Firebase Admin: Ready` : `❌ Firebase Admin: Not configured`);

  if (!uid) {
    results.push(`❌ Account: Not linked`);
    await bot.editMessageText(results.join("\n"), { chat_id: chatId, message_id: statusMsg.message_id });
    return;
  }

  results.push(`✅ Account: Linked`);

  // 3. Notion
  const creds = await getNotionCredsByAdmin(uid).catch(() => null);
  if (!creds) {
    results.push(`❌ Notion: Not connected`);
  } else {
    try {
      const trades = await loadTradesForBot(creds, undefined, 1);
      results.push(`✅ Notion: Connected`);
      // 4. Schema
      const schema = await loadSchemaForBot(uid, creds);
      results.push(schema ? `✅ Schema: Synced (${Object.keys(schema).length} properties)` : `❌ Schema: Could not load`);
      void trades;
    } catch {
      results.push(`❌ Notion: Connection failed`);
      results.push(`❌ Schema: Could not load`);
    }
  }

  // 5. AI
  const aiConfig = await getUserAIConfigByAdmin(uid).catch(() => null);
  if (!aiConfig) {
    results.push(`❌ AI: Not configured`);
  } else {
    const start = Date.now();
    try {
      await callAI(aiConfig, "Health check.", [{ role: "user", content: "hello" }], { maxOutputTokens: 5 });
      results.push(`✅ AI (${aiConfig.provider} / ${aiConfig.model}): Ready — ${Date.now() - start}ms`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      results.push(`❌ AI (${aiConfig.provider}): ${msg}`);
    }
  }

  await bot.editMessageText(
    `🏥 *Health Check Results*\n\n${results.join("\n")}`,
    { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "Markdown" },
  );
}

async function handleModel(bot: TelegramBot, chatId: number): Promise<void> {
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }

  const aiConfig = await getUserAIConfigByAdmin(uid).catch(() => null);
  if (!aiConfig) {
    await bot.sendMessage(chatId, "⚙️ No AI provider configured. Set it up on the website first.");
    return;
  }

  const loadingMsg = await bot.sendMessage(chatId, "⏳ Fetching available models…");

  let models: Array<{ id: string; displayName: string }>;
  if (aiConfig.provider === "gemini") {
    models = await fetchGeminiModels(aiConfig.apiKey);
  } else {
    models = OPENAI_MODELS;
  }

  const keyboard = models.slice(0, 10).map((m) => [{
    text: `${m.id === aiConfig.model ? "✅ " : ""}${m.displayName}`,
    callback_data: `model:${m.id}`,
  }]);

  await bot.editMessageText(
    `🔧 *Select AI Model*\n\nCurrent: \`${aiConfig.model}\`\nProvider: ${aiConfig.provider}\n\nChoose a model:`,
    { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } },
  );
}

async function handleRefresh(bot: TelegramBot, chatId: number): Promise<void> {
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }

  const creds = await getNotionCredsByAdmin(uid).catch(() => null);
  if (!creds) { await bot.sendMessage(chatId, "❌ Notion not connected."); return; }

  clearCachedSchema(uid);
  const msg = await bot.sendMessage(chatId, "🔄 *Smart Refresh 2.0 starting…*", { parse_mode: "Markdown" });
  const edit = (text: string) => bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown" }).catch(() => {});

  try {
    await edit("🔄 *Connecting to Notion…*");
    const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
    const dbId = normalizeDbId(creds.notion_database_id);

    // Verify DB accessibility first
    let dbInfo: Record<string, unknown>;
    try {
      dbInfo = await notion.databases.retrieve({ database_id: dbId }) as Record<string, unknown>;
    } catch (err) {
      await edit(`❌ *Notion access error*\n\nCould not reach your database. Check your Notion connection.\n\n_${err instanceof Error ? err.message : "Unknown error"}_`);
      return;
    }

    const schema = dbInfo.properties as Record<string, unknown>;
    setCachedSchema(uid, schema);

    await edit("📊 *Scanning properties…*");

    // Extract select/multi_select options for accounts, journals, categories
    const propList: string[] = [];
    const accountOptions: string[] = [];
    const selectSummary: string[] = [];
    let journalProp = "";
    let tradeCategoryProp = "";

    for (const [name, prop] of Object.entries(schema)) {
      const p = prop as Record<string, unknown>;
      const type = p.type as string;
      propList.push(`${name} (${type})`);

      if (type === "select" || type === "multi_select") {
        const opts = (p[type] as Record<string, unknown>)?.options as Array<{ name: string }> | undefined;
        const optNames = opts?.map((o) => o.name) ?? [];

        // Detect account property
        const nameLower = name.toLowerCase();
        if (nameLower.includes("account")) accountOptions.push(...optNames);
        if (nameLower.includes("journal")) journalProp = name;
        if (nameLower.includes("category") || nameLower.includes("type")) tradeCategoryProp = name;

        if (optNames.length > 0) {
          selectSummary.push(`• *${name}*: ${optNames.slice(0, 5).join(", ")}${optNames.length > 5 ? "…" : ""}`);
        }
      }
    }

    const propCount = Object.keys(schema).length;
    const dbTitle = ((dbInfo.title as Array<{ plain_text: string }>)?.[0]?.plain_text) ?? "Your Database";

    const lines: string[] = [
      `✅ *Smart Refresh Complete!*`,
      ``,
      `📁 *Database:* ${dbTitle}`,
      `🔧 *Properties:* ${propCount}`,
    ];

    if (accountOptions.length > 0) {
      lines.push(`💼 *Accounts (${accountOptions.length}):* ${accountOptions.slice(0, 5).join(", ")}${accountOptions.length > 5 ? "…" : ""}`);
    }
    if (journalProp) lines.push(`📝 *Journal Property:* ${journalProp}`);
    if (tradeCategoryProp) lines.push(`🏷️ *Category Property:* ${tradeCategoryProp}`);
    if (selectSummary.length > 0) {
      lines.push(``, `*Select Options:*`, ...selectSummary.slice(0, 6));
    }
    lines.push(``, `🟢 *Status:* Healthy`);

    await edit(lines.join("\n"));
  } catch (err) {
    logger.error({ err }, "handleRefresh error");
    await edit(`❌ *Schema refresh failed*\n\n${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleApiHealth(bot: TelegramBot, chatId: number): Promise<void> {
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }

  const aiConfig = await getUserAIConfigByAdmin(uid).catch(() => null);
  if (!aiConfig) { await bot.sendMessage(chatId, "⚙️ No AI provider configured."); return; }

  const msg = await bot.sendMessage(chatId, `⏳ Testing ${aiConfig.provider} (${aiConfig.model})…`);
  const start = Date.now();
  try {
    await callAI(aiConfig, "Health check assistant.", [{ role: "user", content: "hello" }], { maxOutputTokens: 10 });
    await bot.editMessageText(
      `✅ *AI Healthy*\n\nProvider: ${aiConfig.provider}\nModel: \`${aiConfig.model}\`\nLatency: ${Date.now() - start}ms`,
      { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown" },
    );
  } catch (err: unknown) {
    await bot.editMessageText(
      `❌ *AI Error*\n\n${err instanceof Error ? err.message : "Unknown error"}`,
      { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown" },
    );
  }
}

async function handleDisconnect(bot: TelegramBot, chatId: number): Promise<void> {
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }
  pendingDisconnect.set(chatId, Date.now());
  await bot.sendMessage(chatId,
    `⚠️ *Disconnect account?*\n\nThis will unlink your Telegram from Select2Notion.\nReply *yes* to confirm or *no* to cancel.`,
    { parse_mode: "Markdown" },
  );
}

/* ─────────────────────────────────────────────────────────────
   EXECUTE PENDING ACTION
───────────────────────────────────────────────────────────── */

async function executePendingAction(chatId: number, uid: string, bot: TelegramBot): Promise<void> {
  const entry = pendingActions.get(chatId);
  if (!entry) {
    await bot.sendMessage(chatId, "❌ No pending action found.");
    return;
  }
  const action = entry.action;
  pendingActions.delete(chatId);

  const creds = await getNotionCredsByAdmin(uid).catch(() => null);
  if (!creds) {
    await bot.sendMessage(chatId, "❌ Notion not connected.");
    return;
  }

  try {
    if (action.type === "save_trade") {
      const schema = (action.data.schemaSnapshot as Record<string, unknown>) ?? await loadSchemaForBot(uid, creds) ?? {};
      await saveTradeToNotion(creds, action.data.properties as Record<string, unknown>, schema);
      clearCachedSchema(uid);
      await bot.sendMessage(chatId, "✅ *Trade saved to Notion!*\n\nKeep up the great trading journal.", { parse_mode: "Markdown" });
    } else if (action.type === "create_property") {
      const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
      const dbId = normalizeDbId(creds.notion_database_id);
      const name = action.data.name as string;
      const propertyType = action.data.propertyType as string;
      const propertyDef = buildPropertyDefinition(name, propertyType);
      await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: propertyDef } });
      clearCachedSchema(uid);
      await bot.sendMessage(chatId, `✅ *Property "${name}" created!*\n\nUse /refresh to sync the schema.`, { parse_mode: "Markdown" });
    } else if (action.type === "rename_property") {
      const notion = new Client({ auth: creds.notion_token, notionVersion: "2022-06-28" });
      const dbId = normalizeDbId(creds.notion_database_id);
      const { oldName, newName } = action.data as { oldName: string; newName: string };
      await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: { [oldName]: { name: newName } } } });
      clearCachedSchema(uid);
      await bot.sendMessage(chatId, `✅ *Renamed "${oldName}" → "${newName}"*`, { parse_mode: "Markdown" });
    }
  } catch (err: unknown) {
    logger.error({ err, uid, chatId }, "Execute pending action error");
    await bot.sendMessage(chatId, `❌ Action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/* ─────────────────────────────────────────────────────────────
   VOICE MESSAGE HANDLER
───────────────────────────────────────────────────────────── */

/** Transcribes a voice/audio message, showing status updates. Returns transcript or null on failure. */
async function handleVoiceAndTranscribe(chatId: number, uid: string, msg: TelegramBot.Message, bot: TelegramBot): Promise<string | null> {
  const fileId = msg.voice?.file_id ?? msg.audio?.file_id;
  if (!fileId) return null;

  const rawMime = (msg.voice?.mime_type ?? msg.audio?.mime_type ?? "audio/ogg").toLowerCase();
  const cleanMime = rawMime.split(";")[0].trim();
  if (rawMime.startsWith("video/")) {
    await bot.sendMessage(chatId, "❌ Video files are not supported. Send a voice message or audio file.").catch(() => {});
    return null;
  }
  if (!ALLOWED_AUDIO_MIME_TYPES.has(rawMime) && !ALLOWED_AUDIO_MIME_TYPES.has(cleanMime)) {
    await bot.sendMessage(chatId, "❌ Unsupported audio format. Send OGG, MP3, WAV, or M4A.").catch(() => {});
    return null;
  }

  const statusMsg = await bot.sendMessage(chatId, "🎤 *Voice received*", { parse_mode: "Markdown" }).catch(() => null);
  const editStatus = (t: string, opts?: Partial<TelegramBot.EditMessageTextOptions>) =>
    statusMsg
      ? bot.editMessageText(t, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "Markdown", ...opts }).catch(() => {})
      : Promise.resolve();

  try {
    // Parallel: load AI config + file link simultaneously
    await editStatus("🔄 *Preparing…*");
    const [aiConfig, fileLink] = await Promise.all([
      getUserAIConfigByAdmin(uid).catch(() => null),
      bot.getFileLink(fileId).catch(() => null),
    ]);

    if (!aiConfig) { await editStatus("⚙️ *No AI provider configured.*\n\nSet it up on the website first."); return null; }
    if (!fileLink) { await editStatus("❌ *Could not get audio file.* Please try again."); return null; }

    await editStatus("⬇️ *Downloading audio…*");
    const audioBuffer = await withVoiceRetry(
      async () => {
        const resp = await fetch(fileLink);
        if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
        return Buffer.from(await resp.arrayBuffer());
      },
      async (attempt) => { await editStatus(`⚠️ *Retry ${attempt + 1}/3 — downloading…*`); },
    );

    await editStatus("📝 *Transcribing audio…*");
    const transcript = await withVoiceRetry(
      async () => {
        const { transcript: t } = await transcribeAudio(aiConfig, audioBuffer.toString("base64"), rawMime);
        if (!t.trim()) throw new Error("empty_transcript");
        return t;
      },
      async (attempt) => { await editStatus(`⚠️ *Retry ${attempt + 1}/3 — transcribing…*`); },
    );

    // Show FULL transcript (no truncation)
    await editStatus(`🤖 *Processing…*\n\n📋 *Transcript:*\n_${transcript}_`);
    return transcript;
  } catch (err) {
    const isEmpty = err instanceof Error && err.message === "empty_transcript";
    await editStatus(isEmpty
      ? "❌ *Could not transcribe.* Please speak clearly and try again."
      : "❌ *Voice processing failed.* Please try again or type your message.",
    );
    return null;
  }
}

async function handleVoiceMessage(chatId: number, uid: string, msg: TelegramBot.Message, bot: TelegramBot): Promise<void> {
  const fileId = msg.voice?.file_id ?? msg.audio?.file_id;
  if (!fileId) { await bot.sendMessage(chatId, "❌ Could not get audio file."); return; }

  const rawMime = (msg.voice?.mime_type ?? msg.audio?.mime_type ?? "audio/ogg").toLowerCase();
  const cleanMime = rawMime.split(";")[0].trim();

  if (rawMime.startsWith("video/")) {
    await bot.sendMessage(chatId, "❌ Video files are not supported. Send OGG voice or MP3/WAV/M4A audio.");
    return;
  }

  if (!ALLOWED_AUDIO_MIME_TYPES.has(rawMime) && !ALLOWED_AUDIO_MIME_TYPES.has(cleanMime)) {
    await bot.sendMessage(chatId, "❌ Unsupported audio format. Send OGG, MP3, WAV, or M4A.");
    return;
  }

  // ── Step 1: Instantly acknowledge ──
  const statusMsg = await bot.sendMessage(chatId, "🎤 *Voice received*", { parse_mode: "Markdown" });
  const edit = (text: string, opts?: Partial<TelegramBot.EditMessageTextOptions>) =>
    bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "Markdown", ...opts }).catch(() => {});

  try {
    // ── Step 2: Parallel — load AI config + file link simultaneously ──
    await edit("🔄 *Preparing…*");
    const [aiConfig, fileLink] = await Promise.all([
      getUserAIConfigByAdmin(uid).catch(() => null),
      bot.getFileLink(fileId).catch(() => null),
    ]);

    if (!aiConfig) { await edit("⚙️ *No AI provider configured.*\n\nSet it up on the website first."); return; }
    if (!fileLink) { await edit("❌ *Could not get audio file link.* Please try again."); return; }

    // ── Step 3: Download ──
    await edit("⬇️ *Downloading audio…*");
    const audioBuffer = await withVoiceRetry(
      async () => {
        const resp = await fetch(fileLink);
        if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
        return Buffer.from(await resp.arrayBuffer());
      },
      async (attempt) => { await edit(`⚠️ *Retry ${attempt + 1}/3 — downloading…*`); },
    );

    // ── Step 4: Transcribe ──
    await edit("📝 *Transcribing audio…*");
    const transcript = await withVoiceRetry(
      async () => {
        const { transcript: t } = await transcribeAudio(aiConfig, audioBuffer.toString("base64"), rawMime);
        if (!t.trim()) throw new Error("empty_transcript");
        return t;
      },
      async (attempt) => { await edit(`⚠️ *Retry ${attempt + 1}/3 — transcribing…*`); },
    );

    // ── LogTrade mode: auto-process without confirmation ──
    const ltSession = logTradeSessions.get(chatId);
    if (ltSession) {
      await edit(`📋 *Full Transcript:*\n\n_${transcript}_\n\n🤖 *Extracting trade data…*`);
      await processLogTradeInput(chatId, uid, transcript, bot, ltSession).catch((e) => logger.error({ e }, "logtrade voice error"));
      await edit(`✅ *Done!*\n\n📋 _${transcript}_`);
      return;
    }

    // ── Normal mode: show FULL transcript + confirm before AI processing ──
    pendingVoice.set(chatId, { transcript, msgId: statusMsg.message_id, createdAt: Date.now() });

    // Truncate only for display if extremely long (>3800 chars Telegram limit)
    const displayTranscript = transcript.length > 3800
      ? transcript.slice(0, 3800) + "\n\n_(transcript truncated for display — full text will be processed)_"
      : transcript;

    await edit(
      `📋 *Full Transcript:*\n\n_${displayTranscript}_\n\nProcess this with AI?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "🤖 Process", callback_data: "voice_process" },
            { text: "🔄 Retry", callback_data: "voice_retry" },
          ]],
        },
      },
    );

  } catch (err) {
    logger.error({ err }, "Voice processing error in Telegram");
    const isTranscriptErr = err instanceof Error && err.message === "empty_transcript";
    await edit(isTranscriptErr
      ? "❌ *Could not transcribe.* Please speak clearly and try again."
      : "❌ *Voice processing failed after 3 attempts.* Please try again or type your message.",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   DAILY COACH HANDLER
───────────────────────────────────────────────────────────── */

async function handleCoach(bot: TelegramBot, chatId: number): Promise<void> {
  // Immediate ACK — before any awaits
  bot.sendChatAction(chatId, "typing").catch(() => {});

  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked."); return; }

  // Parallel-load AI config + Notion creds
  const [aiConfig, creds] = await Promise.all([
    getUserAIConfigByAdmin(uid).catch(() => null),
    getNotionCredsByAdmin(uid).catch(() => null),
  ]);
  if (!aiConfig) { await bot.sendMessage(chatId, "⚙️ No AI provider configured. Set it up on the website first."); return; }
  if (!creds) { await bot.sendMessage(chatId, "❌ Notion not connected. Set it up on the website first."); return; }

  const msg = await bot.sendMessage(chatId, "🏋️ Generating your weekly coaching summary…");

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const filter = { property: "Date", date: { on_or_after: sevenDaysAgo.toISOString().split("T")[0] } };

    const [schema, trades] = await Promise.all([
      loadSchemaForBot(uid, creds),
      loadTradesForBot(creds, filter, 200),
    ]);

    if (!trades || trades.length === 0) {
      await bot.editMessageText(
        "📊 *Weekly Coach*\n\nNo trades found in the last 7 days. Stay consistent with your journal — even small entries add up! 💪",
        { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown" },
      );
      return;
    }

    const stats = calculateStats(
      trades as Array<Record<string, string | number | null | undefined>>,
      schema ?? {},
    );
    const statsText = formatStatsForPrompt(stats, "LAST 7 DAYS");
    const today = new Date().toISOString().split("T")[0];

    const coachPrompt = `You are an expert AI trading coach. Write a weekly coaching summary for Telegram (max 4 short paragraphs, use *bold* for emphasis, keep it warm and direct):
1. Brief performance overview using the pre-calculated stats
2. Main strength to continue building on
3. One specific area to improve next week
4. A motivating closing line

${statsText}
${trades.length} trades this week. Today: ${today}
DO NOT recalculate P&L — use the pre-calculated stats provided.
IMPORTANT: Respond in the SAME LANGUAGE the user communicates in. If the user's interface is in Burmese (Myanmar script), respond entirely in Burmese. Do NOT default to English when trade symbols (e.g. EURUSD) are in English — those are universal notation, not the user's language.`;

    const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    await streamToTelegram(bot, chatId, aiConfig, coachPrompt,
      [{ role: "user", content: "Generate my weekly coaching summary." }],
      {
        maxOutputTokens: 600,
        existingMsgId: msg.message_id,
        wrapText: (t) => `🏋️ *Weekly Coach*\n\n${t}\n\n_📅 ${dateLabel}_`,
      },
    );
  } catch (err) {
    logger.error({ err }, "Coach command error");
    await bot.editMessageText("❌ Failed to generate coaching summary. Please try again.", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
  }
}

/* ─────────────────────────────────────────────────────────────
   /dashboard — Quick stats card (no AI, instant response)
───────────────────────────────────────────────────────────── */
async function handleDashboard(bot: TelegramBot, chatId: number): Promise<void> {
  // Immediate ACK — before any awaits
  bot.sendChatAction(chatId, "typing").catch(() => {});

  const uid = await getUidForChat(chatId);
  if (!uid) { await bot.sendMessage(chatId, "❌ No account linked. Use /start to connect."); return; }

  const creds = await getNotionCredsByAdmin(uid).catch(() => null);
  if (!creds) { await bot.sendMessage(chatId, "❌ Notion not connected. Set it up on the website first."); return; }

  const msg = await bot.sendMessage(chatId, "📊 Loading dashboard…");

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const filter = { property: "Date", date: { on_or_after: thirtyDaysAgo.toISOString().split("T")[0] } };

    const [schema, trades] = await Promise.all([
      loadSchemaForBot(uid, creds),
      loadTradesForBot(creds, filter, 500),
    ]);

    if (!trades || trades.length === 0) {
      await bot.editMessageText(
        "📊 *Dashboard — Last 30 Days*\n\nNo trades found. Start journaling to see your stats here!",
        { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown" },
      );
      return;
    }

    const stats = calculateStats(
      trades as Array<Record<string, string | number | null | undefined>>,
      schema ?? {},
    );

    const pnl = stats.totalPnL ?? 0;
    const pnlSign = pnl >= 0 ? "+" : "";
    const pnlEmoji = pnl >= 0 ? "🟢" : "🔴";
    const wr = typeof stats.winRate === "number" ? stats.winRate.toFixed(1) : "—";
    const avgWin = typeof stats.maxWin === "number" ? `+${stats.maxWin.toFixed(2)}` : "—";
    const avgLoss = typeof stats.maxLoss === "number" ? stats.maxLoss.toFixed(2) : "—";
    const rr = (typeof stats.avgRR === "number")
      ? stats.avgRR.toFixed(2)
      : "—";
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const text = `📊 *Dashboard — Last 30 Days*

${pnlEmoji} *P&L:* \`${pnlSign}${pnl.toFixed(2)}\`
🎯 *Win Rate:* \`${wr}%\`
📈 *Trades:* \`${trades.length}\`
✅ *Avg Win:* \`${avgWin}\`
❌ *Avg Loss:* \`${avgLoss}\`
⚖️ *R:R:* \`${rr}\`

_Updated: ${today}_

Use /coach for AI coaching or /logtrade to log a trade.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: "Markdown",
    });
  } catch (err) {
    logger.error({ err }, "Dashboard command error");
    await bot.editMessageText("❌ Failed to load dashboard. Please try again.", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
  }
}

/* ─────────────────────────────────────────────────────────────
   LOG TRADE MODE — Property-Aware LogTrade Engine
───────────────────────────────────────────────────────────── */

// Fields where user's EXACT words must be preserved — never rewritten
/* ─────────────────────────────────────────────────────────────
   START BOT (Polling in dev, Webhook in production)
───────────────────────────────────────────────────────────── */

export function startTelegramBot(): void {
  if (bot) {
    logger.warn("startTelegramBot() called more than once — ignoring duplicate call");
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.info("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  try {
    // Detect environment: dev (*.sisko.replit.dev / *.replit.dev) vs production (*.replit.app).
    // Telegram can't reach the Replit dev domain — it's behind mTLS that Telegram's webhook
    // validator can't traverse. In dev we use long-polling so the bot is always reachable.
    // In production the mTLS proxy is absent and the *.replit.app domain is publicly accessible.
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "";
    const isDevDomain = !replitDomain
      || replitDomain.includes(".sisko.")
      || replitDomain.includes(".replit.dev");
    const isProductionDomain = !isDevDomain && replitDomain.includes(".replit.app");

    if (isDevDomain || !isProductionDomain) {
      // ── DEV MODE — BOT INTENTIONALLY DISABLED ────────────────────────────
      // The dev domain is behind Replit mTLS — Telegram cannot reach it via webhook.
      // We CANNOT use polling either: node-telegram-bot-api's polling code automatically
      // calls deleteWebhook() when it gets a 409 "another webhook used" response, which
      // would silently destroy the production webhook every time the dev server starts.
      // Solution: leave bot=null in dev. The production webhook handles all real traffic.
      // To test the bot locally, send messages directly to @select2notionmm_bot on
      // Telegram — they will be processed by the production server.
      logger.info({ domain: replitDomain || "(none)" }, "Telegram bot DISABLED in dev mode (dev domain can't receive webhooks; polling would auto-delete production webhook via library internals)");
    } else {
      // ── WEBHOOK MODE (production) ────────────────────────────────────────
      bot = new TelegramBot(token);

      const webhookUrl = `https://${replitDomain}/api/telegram/webhook`;

      const registerWebhook = (): Promise<void> =>
        fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ["message", "callback_query"],
          }),
        })
          .then((r) => r.json())
          .then((data: any) => {
            if (data?.ok) {
              logger.info({ webhookUrl }, "Telegram webhook registered");
            } else {
              logger.error({ data, webhookUrl }, "Telegram webhook registration failed — check that the production domain is publicly accessible");
            }
          })
          .catch((err) => logger.error({ err, webhookUrl }, "Failed to set Telegram webhook"));

      // Register immediately on startup; retry once after 15s if we hit a 409 conflict
      // (previous deployment instance may still be shutting down)
      registerWebhook().then(() => {
        // Verify after 15 s in case the initial call lost a 409 race
        setTimeout(() => {
          fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
            .then((r) => r.json())
            .then((info: any) => {
              if (!info?.result?.url) {
                logger.warn({ webhookUrl }, "Webhook empty after startup — retrying registration");
                return registerWebhook();
              }
              return;
            })
            .catch(() => {});
        }, 15_000);
      });

      // Auto-repair: every 60 seconds verify the webhook URL is still registered.
      // Telegram can clear the webhook if it receives repeated non-2xx responses.
      // This guard re-registers silently without any manual intervention.
      setInterval(() => {
        fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
          .then((r) => r.json())
          .then((info: any) => {
            const currentUrl: string = info?.result?.url ?? "";
            if (!currentUrl) {
              logger.warn({ webhookUrl }, "Telegram webhook missing — auto-repairing");
              return registerWebhook();
            } else if (currentUrl !== webhookUrl) {
              logger.warn({ currentUrl, webhookUrl }, "Telegram webhook URL mismatch — correcting");
              return registerWebhook();
            }
            return;
          })
          .catch((err) => logger.error({ err }, "Telegram webhook health-check failed"));
      }, 5 * 60_000); // every 5 minutes — reduced from 60s to avoid Telegram API spam
    }

    if (!bot) return; // dev mode — bot intentionally disabled

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const from = msg.from!;
      const text = (msg.text ?? "").trim();

      // Handle voice and audio messages
      if (msg.voice || msg.audio) {
        bot!.sendChatAction(chatId, "typing").catch(() => {}); // immediate feedback before any await
        const uid = await getUidForChat(chatId).catch(() => null);
        if (!uid) {
          await bot!.sendMessage(chatId, "Please link your account first. Go to Settings → Telegram Bot on the website.").catch(() => {});
          return;
        }
        // Route voice into logtrade mode if session is active
        const ltVoiceSession = logTradeSessions.get(chatId);
        if (ltVoiceSession) {
          const transcribed = await handleVoiceAndTranscribe(chatId, uid, msg, bot!).catch((err: unknown) => {
            logger.error({ err }, "voice transcribe error in logtrade");
            return null;
          });
          if (transcribed) {
            await processLogTradeInput(chatId, uid, transcribed, bot!, ltVoiceSession).catch((e) => logger.error({ e }, "logTrade voice error"));
          }
          return;
        }
        await handleVoiceMessage(chatId, uid, msg, bot!).catch((e) => logger.error({ e }, "voice handler error"));
        return;
      }

      if (!text) return;

      // Commands
      if (text.startsWith("/start")) {
        const linkToken = text.split(" ")[1];
        await handleStart(bot!, chatId, from, linkToken).catch((e) => logger.error({ e }, "start error"));
        return;
      }
      if (text === "/help" || text.startsWith("/help@")) { await handleHelp(bot!, chatId).catch(() => {}); return; }
      if (text === "/status") { await handleStatus(bot!, chatId, from).catch(() => {}); return; }
      if (text === "/health") { await handleHealth(bot!, chatId).catch(() => {}); return; }
      if (text === "/model") { await handleModel(bot!, chatId).catch(() => {}); return; }
      if (text === "/refresh") { await handleRefresh(bot!, chatId).catch(() => {}); return; }
      if (text === "/apihealth") { await handleApiHealth(bot!, chatId).catch(() => {}); return; }
      if (text === "/coach") { await handleCoach(bot!, chatId).catch(() => {}); return; }
      if (text === "/dashboard") { await handleDashboard(bot!, chatId).catch((e) => { logger.error({ e }, "dashboard error"); bot!.sendMessage(chatId, "❌ Failed to load dashboard. Try again.").catch(() => {}); }); return; }
      if (text === "/logtrade") { await handleLogTradeWizard(bot!, chatId, getUidForChat).catch((e) => { logger.error({ e }, "logtrade error"); bot!.sendMessage(chatId, "❌ Failed to start trade logging. Try /refresh first, or check your Notion connection.").catch(() => {}); }); return; }

      // /cancel exits logtrade mode (or any pending state)
      if (text === "/cancel") {
        if (logTradeSessions.has(chatId)) {
          logTradeSessions.delete(chatId);
          await bot!.sendMessage(chatId, "❌ Trade logging cancelled.").catch(() => {});
        } else {
          pendingActions.delete(chatId);
          await bot!.sendMessage(chatId, "❌ Cancelled.").catch(() => {});
        }
        return;
      }

      if (text === "/disconnect") { await handleDisconnect(bot!, chatId).catch(() => {}); return; }

      // Pending disconnect confirmation
      if (pendingDisconnect.has(chatId)) {
        pendingDisconnect.delete(chatId);
        if (text.toLowerCase() === "yes") {
          const uid = await getUidForChat(chatId).catch(() => null);
          if (uid && isAdminReady()) {
            await getAdminDb().collection("telegram_connections").doc(uid).delete().catch(() => {});
            invalidateUidCache(chatId);
          }
          conversations.delete(chatId);
          await bot!.sendMessage(chatId, "✅ Account disconnected. Reconnect anytime via Settings → Telegram Bot.").catch(() => {});
        } else {
          await bot!.sendMessage(chatId, "❌ Disconnect cancelled.").catch(() => {});
        }
        return;
      }

      // Require linked account
      const uid = await getUidForChat(chatId).catch(() => null);
      if (!uid) {
        await bot!.sendMessage(chatId, "Please link your account first. Go to Settings → Telegram Bot on the website.").catch(() => {});
        return;
      }

      // ── LogTrade mode: intercept all text messages ──
      const ltSession = logTradeSessions.get(chatId);
      if (ltSession) {
        await processLogTradeInput(chatId, uid, text, bot!, ltSession).catch((e) => logger.error({ e }, "logTrade error"));
        return;
      }

      // ── Explicit slash command shortcuts ──
      if (text === "/review" || text.startsWith("/review@")) {
        await processMessage(chatId, uid, "Give me my weekly trading review for the last 7 days", bot!).catch((e) => logger.error({ e }, "review error"));
        return;
      }
      if (text === "/pattern" || text.startsWith("/pattern@")) {
        await processMessage(chatId, uid, "Analyze my trading patterns and identify what setups, sessions, and pairs work best for me", bot!).catch((e) => logger.error({ e }, "pattern error"));
        return;
      }
      if (text.startsWith("/askdb") && !text.startsWith("/askdb@")) {
        const query = text.slice("/askdb".length).trim();
        if (!query) {
          await bot!.sendMessage(chatId, "💬 Usage: `/askdb <your question>`\n\nExample: `/askdb What was my best trading session last month?`", { parse_mode: "Markdown" }).catch(() => {});
          return;
        }
        await processMessage(chatId, uid, query, bot!).catch((e) => logger.error({ e }, "askdb error"));
        return;
      }

      // Full AI pipeline
      await processMessage(chatId, uid, text, bot!).catch((e) => logger.error({ e }, "processMessage error"));
    });

    bot.on("callback_query", async (query) => {
      const chatId = query.message?.chat.id;
      if (!chatId) return;
      const data = query.data ?? "";

      await bot!.answerCallbackQuery(query.id).catch(() => {});

      /* ── Voice transcript confirmation callbacks ── */
      if (data === "voice_process") {
        const pending = pendingVoice.get(chatId);
        if (!pending) {
          await bot!.sendMessage(chatId, "❌ Voice session expired. Please send your voice message again.").catch(() => {});
          return;
        }
        pendingVoice.delete(chatId);
        const uid2 = await getUidForChat(chatId).catch(() => null);
        if (!uid2) { await bot!.sendMessage(chatId, "❌ Account not linked. Use /start to connect.").catch(() => {}); return; }
        const displayTranscript = pending.transcript.length > 1500
          ? pending.transcript.slice(0, 1500) + "…"
          : pending.transcript;
        await bot!.editMessageText(
          `🤖 *Processing AI request…*\n\n📋 _${displayTranscript}_`,
          { chat_id: chatId, message_id: pending.msgId, parse_mode: "Markdown" },
        ).catch(() => {});
        await processMessage(chatId, uid2, pending.transcript, bot!).catch((e) => logger.error({ e }, "voice_process AI error"));
        await bot!.editMessageText(
          `✅ *Done!*\n\n📋 _${displayTranscript}_`,
          { chat_id: chatId, message_id: pending.msgId, parse_mode: "Markdown" },
        ).catch(() => {});
        return;
      }

      if (data === "voice_retry") {
        pendingVoice.delete(chatId);
        await bot!.editMessageText(
          "🔄 *Cancelled.* Send your voice message again.",
          { chat_id: chatId, message_id: query.message?.message_id, parse_mode: "Markdown" },
        ).catch(() => {});
        return;
      }

      /* ── LogTrade callbacks ── */
      if (data.startsWith("lt_") || data.startsWith("le:")) {
        const session = logTradeSessions.get(chatId);

        // lt_save: save trade to Notion
        if (data === "lt_save") {
          if (!session) { await bot!.sendMessage(chatId, "❌ No active trade session. Use /logtrade to start.").catch(() => {}); return; }
          if (session.saveLocked) { await bot!.sendMessage(chatId, "⏳ Already saving…").catch(() => {}); return; }
          const uid = await getUidForChat(chatId).catch(() => null);
          if (!uid) { await bot!.sendMessage(chatId, "❌ Account not linked.").catch(() => {}); return; }
          const creds = await getNotionCredsByAdmin(uid).catch(() => null);
          if (!creds) { await bot!.sendMessage(chatId, "❌ Notion not connected.").catch(() => {}); return; }

          if (Object.keys(session.fields).length === 0) {
            await bot!.sendMessage(chatId, "❌ No trade data to save. Add some fields first.").catch(() => {});
            return;
          }

          session.saveLocked = true;
          logTradeSessions.delete(chatId);
          const savingMsg = await bot!.sendMessage(chatId, "💾 *Saving trade to Notion…*", { parse_mode: "Markdown" }).catch(() => null);
          try {
            await saveTradeToNotion(creds, session.fields as Record<string, unknown>, session.schema);
            clearCachedSchema(uid);
            if (savingMsg) {
              await bot!.editMessageText(
                `✅ *Trade Saved!*\n\n${buildTradePreviewText(session.fields, session.schema)}\n\n_Great journal entry! 💪_`,
                { chat_id: chatId, message_id: savingMsg.message_id, parse_mode: "Markdown" },
              ).catch(() => {});
            }
          } catch (err) {
            logger.error({ err, chatId }, "lt_save error");
            if (savingMsg) await bot!.editMessageText(`❌ Save failed: ${err instanceof Error ? err.message : "Unknown error"}\n\nYour data is preserved — try again.`, { chat_id: chatId, message_id: savingMsg.message_id }).catch(() => {});
            // Restore session on failure so user can retry
            session.saveLocked = false;
            logTradeSessions.set(chatId, session);
          }
          return;
        }

        // lt_cancel: exit logtrade mode
        if (data === "lt_cancel") {
          logTradeSessions.delete(chatId);
          await bot!.sendMessage(chatId, "❌ Trade logging cancelled. No changes saved.").catch(() => {});
          return;
        }

        if (!session) return;

        // lt_fill: user wants to fill missing fields — go to FILLING state
        if (data === "lt_fill") {
          session.state = "FILLING";
          const missingList = session.missingFields.map((m) => `• ${m}`).join("\n");
          await bot!.sendMessage(chatId,
            `✏️ *Fill missing fields:*\n${missingList}\n\nSend text or voice with the values. Example:\n_"Session: New York, Rules: followed"_`,
            { parse_mode: "Markdown" },
          ).catch(() => {});
          return;
        }

        // lt_skip_missing: skip all missing fields, go to URL step
        if (data === "lt_skip_missing") {
          for (const f of session.missingFields) session.skippedFields.add(f);
          session.missingFields = [];
          await advanceToUrl(chatId, session, bot!);
          return;
        }

        // lt_addurl: start collecting screenshot URLs
        if (data === "lt_addurl") {
          session.collectedUrls = [];
          await promptForNextUrl(chatId, session, bot!).catch(() => {});
          return;
        }

        // lt_url_more: add another URL
        if (data === "lt_url_more") {
          await promptForNextUrl(chatId, session, bot!).catch(() => {});
          return;
        }

        // lt_url_done: done adding URLs, go to preview
        if (data === "lt_url_done") {
          await mergeUrlsAndPreview(chatId, session, bot!).catch(() => {});
          return;
        }

        // lt_skipurl: skip URL, go straight to preview
        if (data === "lt_skipurl") {
          await showFullPreview(chatId, session, bot!);
          return;
        }

        // le:<fieldName>: edit a specific field
        if (data.startsWith("le:")) {
          const fieldName = data.slice(3);
          session.state = "EDIT_FIELD";
          session.editingField = fieldName;
          const isNoRewrite = NO_REWRITE_FIELDS.has(fieldName.toLowerCase());
          await bot!.sendMessage(chatId,
            `✏️ *Edit "${fieldName}"*\n\nCurrent: _${session.fields[fieldName] ?? "(empty)"}_\n\nSend new value${isNoRewrite ? " (exact text preserved)" : ""}:`,
            { parse_mode: "Markdown" },
          ).catch(() => {});
          return;
        }

        return;
      }

      /* ── Regular action callbacks ── */
      if (data === "confirm_action") {
        const uid = await getUidForChat(chatId).catch(() => null);
        if (!uid) { await bot!.sendMessage(chatId, "❌ Account not linked.").catch(() => {}); return; }
        await executePendingAction(chatId, uid, bot!).catch((e) => logger.error({ e }, "executePendingAction error"));
      } else if (data === "cancel_action") {
        pendingActions.delete(chatId);
        await bot!.sendMessage(chatId, "❌ Action cancelled. No changes made.").catch(() => {});
      } else if (data.startsWith("model:")) {
        const newModel = data.slice(6);
        const uid = await getUidForChat(chatId).catch(() => null);
        if (uid) {
          await saveModelPreferenceByAdmin(uid, newModel).catch(() => {});
          await bot!.editMessageText(
            `✅ *Model switched to* \`${newModel}\`\n\nYour AI will now use this model.`,
            { chat_id: chatId, message_id: query.message?.message_id, parse_mode: "Markdown" },
          ).catch(() => {});
        }
      }
    });

    bot.on("webhook_error", (err) => logger.error({ err }, "Telegram webhook error"));
    bot.on("error", (err) => logger.error({ err }, "Telegram bot error"));
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
}

export function getBotUsername(): string { return BOT_USERNAME; }

/* ─────────────────────────────────────────────────────────────
   API ROUTES
───────────────────────────────────────────────────────────── */

/* ── Telegram Webhook endpoint (public — Telegram POSTs updates here, NO auth) ── */
router.post("/telegram/webhook", (req, res) => {
  const t0 = Date.now();
  if (!bot) {
    // Always ACK Telegram with 200 — returning 5xx causes Telegram to disable the webhook.
    // Log so we know the bot object isn't initialised yet (transient startup race).
    logger.warn("Telegram webhook received but bot not initialised — ACKing 200 to prevent webhook disable");
    res.sendStatus(200);
    return;
  }
  try {
    recordWebhookUpdate();
    const updateId = req.body?.update_id;
    const msgType = req.body?.message ? (req.body.message.voice ? "voice" : req.body.message.document ? "document" : req.body.message.photo ? "photo" : "text") : req.body?.callback_query ? "callback_query" : "unknown";
    // ACK Telegram immediately — processing is asynchronous
    res.sendStatus(200);
    const ackMs = Date.now() - t0;
    logger.info({ updateId, msgType, ackMs }, "Telegram webhook ACK sent");
    bot.processUpdate(req.body);
  } catch (err) {
    logger.error({ err }, "Telegram webhook processing error");
    if (!res.headersSent) res.sendStatus(200); // Always 200 to Telegram — never let them retry
  }
});

// Path-specific auth guard — avoids catch-all that blocks other routers' paths.
router.use(
  ["/telegram/status", "/telegram/link", "/telegram/disconnect"],
  requireAuth,
);

router.get("/telegram/status", async (req, res) => {
  const botConfigured = !!process.env.TELEGRAM_BOT_TOKEN;
  if (!isAdminReady() || !botConfigured) {
    res.json({ botAvailable: false, connected: false });
    return;
  }
  try {
    const snap = await getAdminDb().collection("telegram_connections").doc(req.uid!).get();
    if (!snap.exists) {
      res.json({ botAvailable: true, connected: false, botUsername: BOT_USERNAME });
      return;
    }
    const d = snap.data()!;
    res.json({
      botAvailable: true,
      connected: true,
      botUsername: BOT_USERNAME,
      telegramUsername: (d.telegramUsername as string) ?? "",
      telegramFirstName: (d.telegramFirstName as string) ?? "",
      connectedAt: d.connectedAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch {
    res.json({ botAvailable: true, connected: false, botUsername: BOT_USERNAME });
  }
});

router.post("/telegram/link/generate", async (req, res) => {
  if (!isAdminReady() || !process.env.TELEGRAM_BOT_TOKEN) {
    res.status(400).json({ error: "Telegram bot not configured" });
    return;
  }
  try {
    const db = getAdminDb();
    // Clean up old tokens for this user
    const old = await db.collection("telegram_link_requests").where("uid", "==", req.uid!).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));

    const token = makeToken(32);
    await db.collection("telegram_link_requests").doc(token).set({
      uid: req.uid!,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Date.now() + LINK_TOKEN_TTL_MS,
    });

    const username = BOT_USERNAME || "select2notionmm_bot";
    res.json({ deepLink: `https://t.me/${username}?start=${token}`, expiresInMinutes: LINK_TOKEN_TTL_MS / 60000 });
  } catch (err) {
    req.log.error({ err }, "Generate link error");
    res.status(500).json({ error: "Failed to generate link" });
  }
});

router.delete("/telegram/disconnect", async (req, res) => {
  if (!isAdminReady()) { res.status(400).json({ error: "Telegram not configured" }); return; }
  try {
    await getAdminDb().collection("telegram_connections").doc(req.uid!).delete();
    // Purge UID cache — the chatId→uid mapping is no longer valid after disconnect.
    // We don't have chatId here (REST route), so clear all entries for this uid.
    for (const [chatId, entry] of uidCache) {
      if (entry.uid === req.uid!) uidCache.delete(chatId);
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Telegram disconnect error");
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
