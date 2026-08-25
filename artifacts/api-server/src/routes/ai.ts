import { Router } from "express";
import { Client } from "@notionhq/client";
import { requireAuth, getUserNotionCredentials } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { getCachedSchema, clearCachedSchema, computeSchemaDelta } from "../lib/schemaCache.js";
import {
  callGeminiModel, callOpenAI, callAI, classifyIntent, streamAI,
  describeSchemaForAI, normalizeDbId,
  fetchGeminiModels, OPENAI_MODELS,
  transcribeAudio, ALLOWED_AUDIO_MIME_TYPES, VOICE_MAX_BASE64_BYTES,
} from "../lib/aiEngine.js";
import { calculateStats, formatStatsForPrompt } from "../lib/analysisEngine.js";
import { loadNotionSchema } from "../lib/notion/schemaLoader.js";
import { loadNotionTrades } from "../lib/notion/tradeLoader.js";
import { toNotionProperties } from "../lib/notion/tradeMapper.js";
import { buildPropertyDefinition } from "../lib/notion/propertyConfig.js";

const router = Router();
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "select2notion-4f716";

const undoHistory = new Map<string, { type: string; data: Record<string, unknown> }>();

// TTL cleanup for undoHistory — prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of undoHistory) {
    if (now - (entry.data._ts as number ?? 0) > 5 * 60 * 1000) undoHistory.delete(key);
  }
}, 60_000);

/* ─────────────────────────────────────────────────────────────
   FIRESTORE HELPERS (single-doc fetch, batched reads)
───────────────────────────────────────────────────────────── */

interface UserConnectionFields {
  ai_provider?: string;
  ai_api_key?: string;
  ai_model?: string;
  notion_token?: string;
  notion_database_id?: string;
}

async function getUserConnectionFields(uid: string, idToken: string): Promise<UserConnectionFields | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/user_connections/${uid}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const fields = data.fields as Record<string, { stringValue?: string }> | undefined;
    return {
      ai_provider: fields?.ai_provider?.stringValue,
      ai_api_key: fields?.ai_api_key?.stringValue,
      ai_model: fields?.ai_model?.stringValue,
      notion_token: fields?.notion_token?.stringValue,
      notion_database_id: fields?.notion_database_id?.stringValue,
    };
  } catch (err) {
    logger.error({ err, uid }, "Failed to load user connection fields");
    return null;
  }
}

async function getUserAIConfig(uid: string, idToken: string) {
  const fields = await getUserConnectionFields(uid, idToken);
  if (!fields?.ai_provider || !fields?.ai_api_key) return null;
  const model = fields.ai_model ?? (fields.ai_provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
  return { provider: fields.ai_provider, apiKey: fields.ai_api_key, model };
}

/* ─────────────────────────────────────────────────────────────
   SCHEMA LOADER (with cache)
───────────────────────────────────────────────────────────── */

async function loadSchema(uid: string, idToken: string): Promise<Record<string, unknown> | null> {
  const creds = await getUserNotionCredentials(uid, idToken);
  if (!creds) return null;
  return loadNotionSchema(uid, creds);
}

/* ─────────────────────────────────────────────────────────────
   TRADE LOADER
───────────────────────────────────────────────────────────── */

async function loadTrades(
  uid: string,
  idToken: string,
  filter?: Record<string, unknown>,
  maxTrades = 500,
): Promise<Array<Record<string, unknown>>> {
  const creds = await getUserNotionCredentials(uid, idToken);
  if (!creds) return [];
  return loadNotionTrades(creds, filter, maxTrades);
}

/* ─────────────────────────────────────────────────────────────
   GET /ai/models — dynamic list from provider
───────────────────────────────────────────────────────────── */

router.get("/ai/models", requireAuth, async (req, res) => {
  const config = await getUserAIConfig(req.uid!, req.idToken!);
  if (!config) {
    res.status(400).json({ error: "no_ai_credentials", models: [], provider: "" });
    return;
  }

  if (config.provider === "gemini") {
    const models = await fetchGeminiModels(config.apiKey);
    res.json({ models, provider: "gemini" });
    return;
  }

  if (config.provider === "openai") {
    res.json({ provider: "openai", models: OPENAI_MODELS });
    return;
  }

  res.json({ models: [], provider: config.provider });
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/test-connection
───────────────────────────────────────────────────────────── */

router.post("/ai/test-connection", async (req, res) => {
  const { provider, apiKey, model } = req.body as { provider?: string; apiKey?: string; model?: string };
  if (!provider || !apiKey) {
    res.status(400).json({ status: "error", message: "provider and apiKey are required" });
    return;
  }
  const start = Date.now();
  const testModel = model ?? (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
  try {
    if (provider === "gemini") {
      await callGeminiModel(apiKey, testModel, [{ role: "user", text: "hello" }], { temperature: 0, maxOutputTokens: 10 });
      res.json({ status: "connected", message: "Gemini connected", latencyMs: Date.now() - start, model: testModel });
      return;
    }
    if (provider === "openai") {
      await callOpenAI(apiKey, testModel, [{ role: "user", content: "hello" }], { temperature: 0, maxTokens: 10 });
      res.json({ status: "connected", message: "OpenAI connected", latencyMs: Date.now() - start, model: testModel });
      return;
    }
    res.status(400).json({ status: "error", message: "Unknown provider" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const latencyMs = Date.now() - start;
    if (msg === "invalid_key") { res.json({ status: "invalid_key", message: "Invalid API key", latencyMs, model: testModel }); return; }
    if (msg.startsWith("rate_limited")) { res.json({ status: "rate_limited", message: msg.replace("rate_limited:", ""), latencyMs, model: testModel }); return; }
    if (msg.startsWith("auth_error:")) { res.json({ status: "error", message: msg.replace("auth_error:", ""), latencyMs, model: testModel }); return; }
    if (msg.startsWith("model_not_found")) { res.json({ status: "error", message: `Model not found: ${testModel}`, latencyMs, model: testModel }); return; }
    if (msg.includes("timeout")) { res.json({ status: "timeout", message: "Connection timeout", latencyMs, model: testModel }); return; }
    res.json({ status: "error", message: msg, latencyMs, model: testModel });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/schema-refresh — clear + reload schema cache
───────────────────────────────────────────────────────────── */

router.post("/ai/schema-refresh", requireAuth, async (req, res) => {
  const oldSchema = getCachedSchema(req.uid!);
  clearCachedSchema(req.uid!);
  const schema = await loadSchema(req.uid!, req.idToken!);
  if (!schema) {
    res.status(400).json({ error: "schema_error", message: "Could not load schema from Notion." });
    return;
  }
  const delta = computeSchemaDelta(oldSchema, schema);
  res.json({
    success: true,
    propertyCount: Object.keys(schema).length,
    properties: Object.keys(schema),
    delta,
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/chat — intelligent tool router
───────────────────────────────────────────────────────────── */

router.post("/ai/chat", requireAuth, async (req, res) => {
  const { messages, stream: wantsStream } = req.body as { messages?: Array<{ role: string; content: string }>; stream?: boolean };
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const config = await getUserAIConfig(req.uid!, req.idToken!);
  if (!config) {
    res.status(400).json({ error: "no_ai_credentials", message: "Configure your AI provider in Settings first." });
    return;
  }

  const lastUserMsg = messages[messages.length - 1]?.content ?? "";
  const today = new Date().toISOString().split("T")[0];

  try {
    const intent = await classifyIntent(config, lastUserMsg);
    req.log.info({ intent, uid: req.uid }, "AI intent classified");

    /* ── GENERAL CHAT ── */
    if (intent === "general_chat") {
      const systemPrompt = `You are an expert AI trading coach. Help with trading concepts, psychology, risk management, and strategy.
Respond in the SAME LANGUAGE as the user's message. Be concise, practical, and actionable.
Today: ${today}`;
      const reply = await callAI(config, systemPrompt, messages);
      res.json({ reply: reply.trim(), provider: config.provider, intent });
      return;
    }

    /* ── REQUIRE NOTION ── */
    const notionCreds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!notionCreds) {
      res.status(400).json({ error: "no_notion_credentials", message: "Connect your Notion database first to use this feature." });
      return;
    }

    /* ── TRADE LOGGER ── */
    if (intent === "trade_logger") {
      const schema = await loadSchema(req.uid!, req.idToken!);
      if (!schema) {
        res.status(400).json({ error: "schema_error", message: "Could not load your Notion database schema." });
        return;
      }

      const schemaDesc = describeSchemaForAI(schema);
      const extractPrompt = `You are a trade data extractor for a Notion trading journal.

Database schema:
${schemaDesc}

Today's date: ${today}

Extract trade data from the user's message and map it to the exact database property names shown above.
Rules:
- Use the EXACT property names from the schema (case-sensitive)
- For "title" properties: create a descriptive trade name (e.g. "NAS100 - NY Session Long")
- For "date" properties: use today's date (${today}) if not specified
- For "select"/"status" properties: match the value to the closest available option
- For "number" properties: extract the numeric value only (no currency symbols)
- For "multi_select" properties: use comma-separated values
- Only include properties that have data in the message
- Use property aliases: Mindset=Emotion, Trade Setup=Setup, Result=Outcome
- Respond in the SAME LANGUAGE as the user's message

Return ONLY valid JSON:
{
  "summary": {"PropertyName": "human readable value", ...},
  "properties": {"PropertyName": value, ...},
  "reply": "Brief confirmation message in user's language listing what you extracted",
  "confidence": "high" | "medium" | "low"
}`;

      const raw = await callAI(config, extractPrompt, [{ role: "user", content: lastUserMsg }], { temperature: 0.2 });
      let extracted: { summary?: Record<string, unknown>; properties?: Record<string, unknown>; reply?: string; confidence?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) extracted = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!extracted.properties || Object.keys(extracted.properties).length === 0) {
        // Low confidence — ask for clarification
        const reply = await callAI(config, "You are a trading journal assistant. The user seems to be logging a trade but details are unclear. Ask them to provide more details. Respond in their language.", messages);
        res.json({ reply: reply.trim(), provider: config.provider, intent: "general_chat" });
        return;
      }

      res.json({
        reply: extracted.reply ?? "Here's the trade I extracted. Review and confirm:",
        provider: config.provider,
        intent: "trade_logger",
        pendingAction: {
          type: "save_trade",
          summary: extracted.summary ?? {},
          properties: extracted.properties,
        },
      });
      return;
    }

    /* ── ANALYSIS INTENTS (pre-calculate all stats server-side) ── */
    if (["ask_database", "weekly_review", "pattern_analysis", "emotion_analysis"].includes(intent)) {
      let filter: Record<string, unknown> | undefined;
      let periodLabel = "all time";

      if (intent === "weekly_review") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filter = { property: "Date", date: { on_or_after: sevenDaysAgo.toISOString().split("T")[0] } };
        periodLabel = "last 7 days";
      }

      const [schema, trades] = await Promise.all([
        loadSchema(req.uid!, req.idToken!),
        loadTrades(req.uid!, req.idToken!, filter, 300),
      ]);

      if (trades.length === 0) {
        const reply = await callAI(config, `You are a trading coach. The user's Notion journal has no trades${intent === "weekly_review" ? " from the last 7 days" : ""}. Respond in their language.`, messages);
        res.json({ reply: reply.trim(), provider: config.provider, intent });
        return;
      }

      // Server-side statistics (AI must never calculate P&L)
      const stats = calculateStats(trades as Record<string, string | number | null | undefined>[], schema ?? {});
      const statsText = formatStatsForPrompt(stats, `YOUR TRADING STATS — ${periodLabel.toUpperCase()}`);

      // Intent-specific system prompts
      let systemPrompt: string;

      if (intent === "pattern_analysis") {
        systemPrompt = `You are an expert trading pattern analyst.

${statsText}

Sample of ${Math.min(trades.length, 40)} recent trades:
${JSON.stringify(trades.slice(0, 40), null, 0)}

Today: ${today}

Your job: Identify patterns in the pre-calculated statistics above.
- Which sessions, setups, and pairs consistently perform best?
- What time-based patterns exist?
- What are the key correlations between trade setup and outcome?
- What should the trader focus on and what should they avoid?
DO NOT recalculate P&L — use the statistics provided.
Respond in the SAME LANGUAGE as the user's message.`;
      } else if (intent === "emotion_analysis") {
        systemPrompt = `You are an expert trading psychology analyst.

${statsText}

Sample of ${Math.min(trades.length, 40)} recent trades:
${JSON.stringify(trades.slice(0, 40), null, 0)}

Today: ${today}

Your job: Analyze the emotional/mindset patterns in the pre-calculated statistics.
- Which emotional states produce the best results?
- Which mindsets lead to losses?
- What psychological patterns need improvement?
- Give specific, actionable advice for emotional discipline.
DO NOT recalculate P&L — use the statistics provided.
Respond in the SAME LANGUAGE as the user's message.`;
      } else if (intent === "weekly_review") {
        systemPrompt = `You are an expert AI trading coach conducting a weekly performance review.

${statsText}

${trades.length > 40 ? `All ${trades.length} trades this week (showing last 40):` : `All ${trades.length} trades this week:`}
${JSON.stringify(trades.slice(0, 40), null, 0)}

Today: ${today} — Period: ${periodLabel}

Generate a comprehensive weekly review:
1. Overall performance summary (use stats above)
2. Best and worst aspects of this week
3. Key patterns identified
4. Emotional/psychological observations
5. 3 specific, actionable improvements for next week
DO NOT recalculate P&L — use the statistics provided.
Respond in the SAME LANGUAGE as the user's message.`;
      } else {
        systemPrompt = `You are an expert AI trading analyst with access to the user's complete trading journal.

${statsText}

${trades.length > 50 ? `${trades.length} total trades (showing 50 most recent):` : `${trades.length} trades:`}
${JSON.stringify(trades.slice(0, 50), null, 0)}

Today: ${today}

Answer the user's question using the data above. Be specific, mention numbers, dates, and patterns.
DO NOT recalculate P&L — use the pre-calculated statistics.
Respond in the SAME LANGUAGE as the user's message.`;
      }

	      if (wantsStream) {
	        res.setHeader("Content-Type", "text/event-stream");
	        res.setHeader("Cache-Control", "no-cache");
	        res.setHeader("Connection", "keep-alive");
	        res.setHeader("X-Accel-Buffering", "no");
	        res.flushHeaders();

	        let aborted = false;
	        res.on("close", () => { aborted = true; });

	        try {
	          for await (const chunk of streamAI(config, systemPrompt, messages, { maxOutputTokens: 2048 })) {
	            if (aborted) break; // Client disconnected — stop wasting AI tokens
	            res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
	          }
	        } catch (e) {
	          if (!aborted) res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
	        }
	        if (!aborted) {
	          res.write(`data: ${JSON.stringify({ done: true, provider: config.provider, intent })}\n\n`);
	        }
	        res.end();
	        return;
	      }

      const reply = await callAI(config, systemPrompt, messages, { maxOutputTokens: 2048 });
      res.json({ reply: reply.trim(), provider: config.provider, intent });
      return;
    }

    /* ── PROPERTY CREATOR ── */
    if (intent === "property_creator") {
      const schema = await loadSchema(req.uid!, req.idToken!);
      const existingNames = schema ? Object.keys(schema) : [];

      const parsePrompt = `You are a Notion database manager. Parse the user's request to create a new property.
Existing properties: ${existingNames.join(", ")}
Supported types: title, rich_text, number, select, multi_select, checkbox, date, url
Message: "${lastUserMsg}"
Return ONLY valid JSON: {"name":"Property Name","propertyType":"type","reply":"Confirmation in user's language"}`;

      const raw = await callAI(config, parsePrompt, [{ role: "user", content: lastUserMsg }], { temperature: 0.1 });
      let parsed: { name?: string; propertyType?: string; reply?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!parsed.name || !parsed.propertyType) {
        const reply = await callAI(config, "You are a trading journal assistant. Respond in the user's language.", messages);
        res.json({ reply: reply.trim(), provider: config.provider, intent: "general_chat" });
        return;
      }

      if (existingNames.includes(parsed.name)) {
        res.json({ reply: `The property "${parsed.name}" already exists. Choose a different name.`, provider: config.provider, intent });
        return;
      }

      res.json({
        reply: parsed.reply ?? `Create property "${parsed.name}" (${parsed.propertyType})?`,
        provider: config.provider,
        intent: "property_creator",
        pendingAction: { type: "create_property", name: parsed.name, propertyType: parsed.propertyType },
      });
      return;
    }

    /* ── PROPERTY EDITOR ── */
    if (intent === "property_editor") {
      const schema = await loadSchema(req.uid!, req.idToken!);
      const existingNames = schema ? Object.keys(schema) : [];

      const parsePrompt = `You are a Notion database manager. Parse the user's request to rename a property.
Existing properties: ${existingNames.join(", ")}
Message: "${lastUserMsg}"
Find the best-matching existing property and the requested new name.
Return ONLY valid JSON: {"oldName":"exact existing name","newName":"new name","reply":"Confirmation in user's language"}`;

      const raw = await callAI(config, parsePrompt, [{ role: "user", content: lastUserMsg }], { temperature: 0.1 });
      let parsed: { oldName?: string; newName?: string; reply?: string } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* fallback */ }

      if (!parsed.oldName || !parsed.newName) {
        const reply = await callAI(config, "You are a trading journal assistant. Respond in the user's language.", messages);
        res.json({ reply: reply.trim(), provider: config.provider, intent: "general_chat" });
        return;
      }

      if (!existingNames.includes(parsed.oldName)) {
        res.json({
          reply: `I couldn't find "${parsed.oldName}". Available: ${existingNames.join(", ")}`,
          provider: config.provider,
          intent,
        });
        return;
      }

      res.json({
        reply: parsed.reply ?? `Rename "${parsed.oldName}" → "${parsed.newName}"?`,
        provider: config.provider,
        intent: "property_editor",
        pendingAction: { type: "rename_property", oldName: parsed.oldName, newName: parsed.newName },
      });
      return;
    }

    /* ── FALLBACK ── */
	    const fallbackPrompt = `You are an expert AI trading coach. Respond in the SAME LANGUAGE as the user's message.`;
	    if (wantsStream) {
	      res.setHeader("Content-Type", "text/event-stream");
	      res.setHeader("Cache-Control", "no-cache");
	      res.setHeader("Connection", "keep-alive");
	      res.setHeader("X-Accel-Buffering", "no");
	      res.flushHeaders();

	      let aborted = false;
	      res.on("close", () => { aborted = true; });

	      try {
	        for await (const chunk of streamAI(config, fallbackPrompt, messages)) {
	          if (aborted) break; // Client disconnected — stop wasting AI tokens
	          res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
	        }
	      } catch (e) {
	        if (!aborted) res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
	      }
	      if (!aborted) {
	        res.write(`data: ${JSON.stringify({ done: true, provider: config.provider, intent: "general_chat" })}\n\n`);
	      }
	      res.end();
	      return;
	    }
	    const reply = await callAI(config, fallbackPrompt, messages);
	    res.json({ reply: reply.trim(), provider: config.provider, intent: "general_chat" });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "AI chat error");
    if (msg === "invalid_key") {
      res.status(400).json({ error: "invalid_key", message: "Your AI API key is invalid. Update it in Settings." });
    } else if (msg.startsWith("rate_limited")) {
      res.status(429).json({ error: "rate_limited", message: "AI rate limit hit. Please wait a moment." });
    } else if (msg.includes("timeout")) {
      res.status(504).json({ error: "timeout", message: "AI response timed out. Please try again." });
    } else {
      res.status(500).json({ error: "ai_error", message: msg });
    }
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/confirm-action
───────────────────────────────────────────────────────────── */

router.post("/ai/confirm-action", requireAuth, async (req, res) => {
  const { actionType, data } = req.body as { actionType?: string; data?: Record<string, unknown> };
  if (!actionType) {
    res.status(400).json({ success: false, message: "actionType is required" });
    return;
  }

  const notionCreds = await getUserNotionCredentials(req.uid!, req.idToken!);
  if (!notionCreds) {
    res.status(400).json({ success: false, message: "Notion not connected." });
    return;
  }

  const notion = new Client({ auth: notionCreds.notion_token, notionVersion: "2022-06-28" });
  const dbId = normalizeDbId(notionCreds.notion_database_id);

  try {
    /* ── SAVE TRADE ── */
    if (actionType === "save_trade") {
      const tradeFields = (data?.properties ?? {}) as Record<string, unknown>;
      const schema = await loadSchema(req.uid!, req.idToken!);
      if (!schema) {
        res.status(400).json({ success: false, message: "Could not load database schema." });
        return;
      }

      const properties = toNotionProperties(tradeFields, schema);

      const response = await notion.pages.create({
        parent: { database_id: dbId } as Parameters<typeof notion.pages.create>[0]["parent"],
        properties: properties as Parameters<typeof notion.pages.create>[0]["properties"],
      }) as Record<string, unknown>;

      const tradeId = response.id as string;
      undoHistory.set(req.uid!, { type: "saved_trade", data: { pageId: tradeId, _ts: Date.now() } });
      res.json({ success: true, message: "Trade saved successfully! ✅", tradeId });
      return;
    }

    /* ── CREATE PROPERTY ── */
    if (actionType === "create_property") {
      const name = data?.name as string;
      const propertyType = data?.propertyType as string;
      if (!name || !propertyType) {
        res.status(400).json({ success: false, message: "name and propertyType are required" });
        return;
      }

      const propertyDef = buildPropertyDefinition(name, propertyType);

      await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: propertyDef } });
      clearCachedSchema(req.uid!);
      undoHistory.set(req.uid!, { type: "created_property", data: { name, _ts: Date.now() } });
      res.json({ success: true, message: `Property "${name}" created! ✅` });
      return;
    }

    /* ── RENAME PROPERTY ── */
    if (actionType === "rename_property") {
      const oldName = data?.oldName as string;
      const newName = data?.newName as string;
      if (!oldName || !newName) {
        res.status(400).json({ success: false, message: "oldName and newName are required" });
        return;
      }

      await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: { [oldName]: { name: newName } } } });
      clearCachedSchema(req.uid!);
      undoHistory.set(req.uid!, { type: "renamed_property", data: { oldName, newName, _ts: Date.now() } });
      res.json({ success: true, message: `Renamed "${oldName}" → "${newName}" ✅` });
      return;
    }

    /* ── UNDO ── */
    if (actionType === "undo") {
      const last = undoHistory.get(req.uid!);
      if (!last) { res.json({ success: false, message: "Nothing to undo." }); return; }

      if (last.type === "saved_trade") {
        await notion.pages.update({ page_id: last.data.pageId as string, archived: true });
        undoHistory.delete(req.uid!);
        res.json({ success: true, message: "Trade entry removed ✅" });
        return;
      }
      if (last.type === "renamed_property") {
        const { newName, oldName } = last.data as { newName: string; oldName: string };
        await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: { [newName]: { name: oldName } } } });
        clearCachedSchema(req.uid!);
        undoHistory.delete(req.uid!);
        res.json({ success: true, message: `Renamed back to "${oldName}" ✅` });
        return;
      }

      undoHistory.delete(req.uid!);
      res.json({ success: false, message: `Cannot auto-undo "${last.type}".` });
      return;
    }

    res.status(400).json({ success: false, message: `Unknown action: ${actionType}` });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    req.log.error({ err: error }, "AI confirm-action error");
    res.status(500).json({ success: false, message: msg });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/voice — audio transcription
───────────────────────────────────────────────────────────── */

router.post("/ai/voice", requireAuth, async (req, res) => {
  const { audioBase64, mimeType } = req.body as { audioBase64?: string; mimeType?: string };

  if (!audioBase64 || !mimeType) {
    res.status(400).json({ error: "missing_fields", message: "audioBase64 and mimeType are required" });
    return;
  }

  // Server-side size guard: base64 > 40 MB = beyond 5-minute limit
  if (audioBase64.length > VOICE_MAX_BASE64_BYTES) {
    res.status(413).json({
      error: "VOICE_TOO_LARGE",
      message: "Voice recording exceeds the 5-minute maximum. Please shorten your recording.",
    });
    return;
  }

  const cleanMime = mimeType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType.toLowerCase()) && !ALLOWED_AUDIO_MIME_TYPES.has(cleanMime)) {
    res.status(400).json({
      error: "VOICE_FORMAT_ERROR",
      message: `Audio format "${cleanMime}" is not supported. Use OGG, MP3, WAV, M4A, or WebM.`,
    });
    return;
  }

  const config = await getUserAIConfig(req.uid!, req.idToken!);
  if (!config) {
    res.status(400).json({ error: "no_ai_credentials", message: "Configure your AI provider in Settings first." });
    return;
  }

  try {
    const result = await transcribeAudio(config, audioBase64, mimeType);
    res.json({ transcript: result.transcript.trim(), detectedLanguage: result.detectedLanguage });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Voice transcription error");

    if (msg.startsWith("GEMINI_RATE_LIMIT:") || msg.startsWith("OPENAI_RATE_LIMIT:")) {
      res.status(429).json({ error: "GEMINI_RATE_LIMIT", message: "AI rate limit reached. Please try again in 60 seconds." });
    } else if (msg.startsWith("NETWORK_TIMEOUT:")) {
      res.status(504).json({ error: "NETWORK_TIMEOUT", message: "Server timeout processing audio. Try a shorter recording." });
    } else if (msg.startsWith("TRANSCRIPTION_FAILED:")) {
      res.status(500).json({ error: "TRANSCRIPTION_FAILED", message: "Audio could not be transcribed. Please try again." });
    } else if (msg.includes("abort") || msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      res.status(504).json({ error: "NETWORK_TIMEOUT", message: "Server timeout. The audio may be too long. Please try a shorter recording." });
    } else {
      res.status(500).json({ error: "TRANSCRIPTION_FAILED", message: msg });
    }
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /ai/dashboard — personal trading stats
───────────────────────────────────────────────────────────── */

router.get("/ai/dashboard", requireAuth, async (req, res) => {
  const notionCreds = await getUserNotionCredentials(req.uid!, req.idToken!);
  if (!notionCreds) {
    res.status(400).json({ error: "no_notion_credentials", message: "Connect your Notion database first." });
    return;
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentFilter = {
      property: "Date",
      date: { on_or_after: thirtyDaysAgo.toISOString().split("T")[0] },
    };

    const [schema, allTrades, recentTrades] = await Promise.all([
      loadSchema(req.uid!, req.idToken!),
      loadTrades(req.uid!, req.idToken!, undefined, 1000),
      loadTrades(req.uid!, req.idToken!, recentFilter, 300),
    ]);

    const schemaOrEmpty = schema ?? {};
    const allStats = calculateStats(
      allTrades as Array<Record<string, string | number | null | undefined>>,
      schemaOrEmpty,
    );
    const recentStats = calculateStats(
      recentTrades as Array<Record<string, string | number | null | undefined>>,
      schemaOrEmpty,
    );

    res.json({
      all: allStats,
      recent30d: recentStats,
      tradeCount: allTrades.length,
      recentTradeCount: recentTrades.length,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Dashboard error");
    res.status(500).json({ error: "dashboard_error", message: "Failed to load dashboard data." });
  }
});

/* ─────────────────────────────────────────────────────────────
   DAILY COACH — in-memory store + endpoints
───────────────────────────────────────────────────────────── */

interface CoachPrefs {
  enabled: boolean;
  lastSummary?: string;
  lastSummaryDate?: string;
}

const coachPrefs = new Map<string, CoachPrefs>();

router.get("/ai/coach", requireAuth, (req, res) => {
  const prefs = coachPrefs.get(req.uid!) ?? { enabled: false };
  res.json(prefs);
});

router.post("/ai/coach/toggle", requireAuth, (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  const current = coachPrefs.get(req.uid!) ?? { enabled: false };
  const updated: CoachPrefs = { ...current, enabled: !!enabled };
  coachPrefs.set(req.uid!, updated);
  res.json({ success: true, enabled: updated.enabled });
});

router.post("/ai/coach/generate", requireAuth, async (req, res) => {
  const config = await getUserAIConfig(req.uid!, req.idToken!);
  if (!config) {
    res.status(400).json({ error: "no_ai_credentials", message: "Configure your AI provider in Settings first." });
    return;
  }

  const notionCreds = await getUserNotionCredentials(req.uid!, req.idToken!);
  if (!notionCreds) {
    res.status(400).json({ error: "no_notion_credentials", message: "Connect your Notion database first." });
    return;
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const filter = { property: "Date", date: { on_or_after: sevenDaysAgo.toISOString().split("T")[0] } };

  try {
    const [schema, trades] = await Promise.all([
      loadSchema(req.uid!, req.idToken!),
      loadTrades(req.uid!, req.idToken!, filter, 200),
    ]);

    if (trades.length === 0) {
      const summary = "No trades found in the last 7 days. Stay consistent — journaling even one trade a day builds powerful long-term insights.";
      res.json({ summary, date: new Date().toISOString(), tradeCount: 0 });
      return;
    }

    const stats = calculateStats(
      trades as Array<Record<string, string | number | null | undefined>>,
      schema ?? {},
    );
    const statsText = formatStatsForPrompt(stats, "LAST 7 DAYS");
    const today = new Date().toISOString().split("T")[0];

    const coachPrompt = `You are an expert AI trading coach writing a personal weekly coaching summary.

${statsText}

${trades.length} trades this week. Today: ${today}

Write a concise, motivating weekly coaching summary (4 paragraphs max):
1. Performance overview — use the pre-calculated stats, cite real numbers
2. Key strength to continue building on
3. One specific, actionable improvement for next week
4. A brief motivating closing remark
Keep it personal and direct. DO NOT recalculate P&L — only use the stats provided above.
Respond in the same language as the user's trading entries if detectable, otherwise English.`;

    const summary = await callAI(
      config,
      coachPrompt,
      [{ role: "user", content: "Generate my weekly coaching summary." }],
      { maxOutputTokens: 1200 },
    );

    const date = new Date().toISOString();
    const current = coachPrefs.get(req.uid!) ?? { enabled: false };
    coachPrefs.set(req.uid!, { ...current, lastSummary: summary.trim(), lastSummaryDate: date });

    res.json({ summary: summary.trim(), date, tradeCount: trades.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Coach generate error");
    res.status(500).json({ error: "coach_error", message: msg });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /ai/reflect (legacy — kept for compatibility)
───────────────────────────────────────────────────────────── */

router.post("/ai/reflect", requireAuth, async (req, res) => {
  const { preset, dateFrom, dateTo, language, customPrompt } = req.body as {
    preset?: string; dateFrom?: string; dateTo?: string;
    language?: string; customPrompt?: string;
  };
  if (!preset || !dateFrom || !dateTo) {
    res.status(400).json({ error: "preset, dateFrom, dateTo are required" });
    return;
  }
  const config = await getUserAIConfig(req.uid!, req.idToken!);
  if (!config) {
    res.status(400).json({ error: "no_ai_credentials", message: "Configure your AI provider in Settings first." });
    return;
  }
  const prompt = [
    `You are an expert trading journal analyst. Analyze the following period and provide a structured reflection.`,
    `Period: ${dateFrom} to ${dateTo}. Preset: ${preset}.`,
    language === "myanmar" ? "Respond in Myanmar/Burmese language." : "Respond in English.",
    customPrompt ? `Additional focus: ${customPrompt}` : "",
    `Return a JSON object: {"score":<0-100>,"summary":"<max 300 words>","insights":["<insight>",...],"flashCards":{"bestTrade":"...","worstTrade":"...","keyLesson":"...","nextAction":"..."}}`,
    `Return ONLY the JSON, no markdown.`,
  ].filter(Boolean).join("\n");
  try {
    const raw = await callAI(config, "You are a trading analyst. Return only valid JSON.", [{ role: "user", content: prompt }]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in AI response");
    res.json(JSON.parse(match[0]));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "AI reflect error");
    res.status(500).json({ error: "ai_error", message: msg });
  }
});

export default router;
