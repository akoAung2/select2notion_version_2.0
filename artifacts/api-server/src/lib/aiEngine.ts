/**
 * Shared AI Engine — used by both routes/ai.ts (web) and routes/telegram.ts (bot).
 * All AI calling, model management, intent classification, and admin helpers live here.
 */

import { getAdminDb, isAdminReady } from "./firebaseAdmin.js";
import { logger } from "./logger.js";

/* ─────────────────────────────────────────────────────────────
   TYPES & CONSTANTS
───────────────────────────────────────────────────────────── */

export interface AIConfig { provider: string; apiKey: string; model: string }
export interface NotionAdminCredentials { notion_token: string; notion_database_id: string }

export const AI_EXCLUDED_TYPES = new Set([
  "files", "url", "email", "phone_number",
  "created_time", "created_by", "last_edited_time", "last_edited_by",
  "rollup", "relation", "unique_id",
  "formula", "people", // auto-computed or user-reference types — never useful for AI extraction
]);

export const GEMINI_FALLBACK_MODELS = [
  { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro" },
];

export const OPENAI_MODELS = [
  { id: "gpt-4o", displayName: "GPT-4o" },
  { id: "gpt-4o-mini", displayName: "GPT-4o Mini" },
  { id: "gpt-4-turbo", displayName: "GPT-4 Turbo" },
  { id: "gpt-3.5-turbo", displayName: "GPT-3.5 Turbo" },
];

export const INTENTS = [
  "general_chat",
  "ask_database",
  "trade_logger",
  "weekly_review",
  "property_creator",
  "property_editor",
  "pattern_analysis",
  "emotion_analysis",
] as const;
export type Intent = typeof INTENTS[number];

/* ─────────────────────────────────────────────────────────────
   DATA MAPPING HELPERS
───────────────────────────────────────────────────────────── */

export function normalizeDbId(raw: string): string {
  return raw.replace(/-/g, "").match(/[a-f0-9]{32}/i)?.[0] ?? raw;
}

export function describeSchemaForAI(schema: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, prop] of Object.entries(schema)) {
    const p = prop as Record<string, unknown>;
    const type = p.type as string;
    if (AI_EXCLUDED_TYPES.has(type)) continue;
    let desc = `"${name}" (${type})`;
    if (type === "select") {
      const opts = ((p.select as { options?: Array<{ name: string }> })?.options ?? []).map((o) => o.name);
      if (opts.length) desc += ` — options: [${opts.join(", ")}]`;
    } else if (type === "multi_select") {
      const opts = ((p.multi_select as { options?: Array<{ name: string }> })?.options ?? []).map((o) => o.name);
      if (opts.length) desc += ` — options: [${opts.join(", ")}]`;
    } else if (type === "status") {
      const opts = ((p.status as { options?: Array<{ name: string }> })?.options ?? []).map((o) => o.name);
      if (opts.length) desc += ` — status options: [${opts.join(", ")}]`;
    }
    lines.push(desc);
  }
  return lines.join("\n");
}

/* ─────────────────────────────────────────────────────────────
   GEMINI API
───────────────────────────────────────────────────────────── */

export async function callGeminiModel(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; text: string }>,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text }],
        })),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 4096,
        },
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: { message: resp.statusText } })) as Record<string, unknown>;
      const msg = (err?.error as { message?: string })?.message ?? resp.statusText;
      if (resp.status === 400 && msg.toLowerCase().includes("api key")) throw new Error("invalid_key");
      if (resp.status === 401 || resp.status === 403) throw new Error(`auth_error:${msg}`);
      if (resp.status === 429) throw new Error(`rate_limited:${msg}`);
      if (resp.status === 404) throw new Error(`model_not_found:${model}`);
      throw new Error(msg);
    }
    const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
    throw err;
  }
}

/** Gemini streaming — yields text chunks via SSE */
export async function* callGeminiStream(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; text: string }>,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text }],
        })),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 4096,
        },
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      if (resp.status === 400 && errText.toLowerCase().includes("api key")) throw new Error("invalid_key");
      if (resp.status === 401 || resp.status === 403) throw new Error(`auth_error:${errText.slice(0, 100)}`);
      if (resp.status === 429) throw new Error(`rate_limited:${errText.slice(0, 100)}`);
      if (resp.status === 404) throw new Error(`model_not_found:${model}`);
      throw new Error(errText.slice(0, 200));
    }
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;
        try {
          const chunk = JSON.parse(jsonStr) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch { /* skip malformed chunk */ }
      }
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
    throw err;
  }
}

/* ─────────────────────────────────────────────────────────────
   OPENAI API
───────────────────────────────────────────────────────────── */

export async function callOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: { message: resp.statusText } })) as Record<string, unknown>;
      const msg = (err?.error as { message?: string })?.message ?? resp.statusText;
      if (resp.status === 401) throw new Error("invalid_key");
      if (resp.status === 429) throw new Error(`rate_limited:${msg}`);
      throw new Error(msg);
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data?.choices?.[0]?.message?.content ?? "";
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
    throw err;
  }
}

/** OpenAI streaming — yields content chunks via SSE */
export async function* callOpenAIStream(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      if (resp.status === 401) throw new Error("invalid_key");
      if (resp.status === 429) throw new Error(`rate_limited:${errText.slice(0, 100)}`);
      throw new Error(errText.slice(0, 200));
    }
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;
        try {
          const chunk = JSON.parse(jsonStr) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch { /* skip malformed chunk */ }
      }
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") throw new Error("timeout");
    throw err;
  }
}

/* ─────────────────────────────────────────────────────────────
   UNIFIED CALLERS (non-streaming + streaming)
───────────────────────────────────────────────────────────── */

export async function callAI(
  config: AIConfig,
  systemPrompt: string,
  userMessages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  if (config.provider === "gemini") {
    const msgs: Array<{ role: string; text: string }> = [
      { role: "user", text: systemPrompt },
      { role: "model", text: "Understood." },
      ...userMessages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content })),
    ];
    return callGeminiModel(config.apiKey, config.model, msgs, {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });
  }
  if (config.provider === "openai") {
    const msgs = [
      { role: "system", content: systemPrompt },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];
    return callOpenAI(config.apiKey, config.model, msgs, {
      temperature: options.temperature,
      maxTokens: options.maxOutputTokens,
    });
  }
  throw new Error("Unsupported provider");
}

/** Streaming unified caller — yields text chunks as they arrive from the AI */
export async function* streamAI(
  config: AIConfig,
  systemPrompt: string,
  userMessages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): AsyncGenerator<string> {
  if (config.provider === "gemini") {
    const msgs: Array<{ role: string; text: string }> = [
      { role: "user", text: systemPrompt },
      { role: "model", text: "Understood." },
      ...userMessages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content })),
    ];
    yield* callGeminiStream(config.apiKey, config.model, msgs, {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });
    return;
  }
  if (config.provider === "openai") {
    const msgs = [
      { role: "system", content: systemPrompt },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];
    yield* callOpenAIStream(config.apiKey, config.model, msgs, {
      temperature: options.temperature,
      maxTokens: options.maxOutputTokens,
    });
    return;
  }
  throw new Error("Unsupported provider");
}

/* ─────────────────────────────────────────────────────────────
   DYNAMIC MODEL FETCHING
───────────────────────────────────────────────────────────── */

export async function fetchGeminiModels(apiKey: string): Promise<Array<{ id: string; displayName: string }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return GEMINI_FALLBACK_MODELS;
    const data = (await resp.json()) as {
      models?: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>;
    };
    const models = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({ id: m.name.replace("models/", ""), displayName: m.displayName || m.name.replace("models/", "") }))
      .sort((a, b) => {
        const p = (id: string) => {
          if (id.includes("2.5") && id.includes("flash")) return 0;
          if (id.includes("2.5") && id.includes("pro")) return 1;
          if (id.includes("2.0")) return 2;
          if (id.includes("1.5")) return 3;
          return 4;
        };
        return p(a.id) - p(b.id);
      });
    return models.length > 0 ? models : GEMINI_FALLBACK_MODELS;
  } catch {
    clearTimeout(timeout);
    return GEMINI_FALLBACK_MODELS;
  }
}

/* ─────────────────────────────────────────────────────────────
   INTENT CLASSIFIER (shared)
───────────────────────────────────────────────────────────── */

export async function classifyIntent(config: AIConfig, lastMessage: string): Promise<Intent> {
  const systemPrompt = `You are an intent classifier for a trading journal AI. Classify the user's message into exactly ONE intent:

- general_chat: Trading concepts, education, general advice, psychology theory, risk theory (no personal data needed)
- ask_database: Questions about the user's own trades, performance, history, statistics, results
- trade_logger: User wants to log, record, or save a specific trade they took
- weekly_review: User explicitly asks for a weekly or periodic summary/review of their trades
- property_creator: User wants to create a new field/column/property in their Notion database
- property_editor: User wants to rename, modify, or update an existing field/column
- pattern_analysis: User asks about patterns, best/worst session, best setup, pair performance, time analysis
- emotion_analysis: User asks about emotions, mindset, psychology patterns in their trades

Return ONLY valid JSON: {"intent": "ONE_OF_THE_ABOVE"}`;

  try {
    const raw = await callAI(config, systemPrompt, [{ role: "user", content: lastMessage }], { temperature: 0, maxOutputTokens: 200 });
    const match = raw.match(/"intent"\s*:\s*"([^"]+)"/);
    const intent = match?.[1] as Intent | undefined;
    if (intent && (INTENTS as readonly string[]).includes(intent)) return intent;
    logger.warn({ raw: raw.slice(0, 120), intent }, "Intent classifier returned invalid intent, defaulting to general_chat");
    return "general_chat";
  } catch (err) {
    logger.error({ err, message: lastMessage.slice(0, 100) }, "Intent classification failed, defaulting to general_chat");
    return "general_chat";
  }
}

/* ─────────────────────────────────────────────────────────────
   FIREBASE ADMIN HELPERS (Telegram bot — no idToken available)
───────────────────────────────────────────────────────────── */

export async function getUserAIConfigByAdmin(uid: string): Promise<AIConfig | null> {
  if (!isAdminReady()) return null;
  try {
    const snap = await getAdminDb().collection("user_connections").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    const provider = d.ai_provider as string | undefined;
    const apiKey = d.ai_api_key as string | undefined;
    if (!provider || !apiKey) return null;
    const model = (d.ai_model as string | undefined) ?? (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
    return { provider, apiKey, model };
  } catch (err) {
    logger.error({ err, uid }, "getUserAIConfigByAdmin failed");
    return null;
  }
}

export async function getNotionCredsByAdmin(uid: string): Promise<NotionAdminCredentials | null> {
  if (!isAdminReady()) return null;
  try {
    const snap = await getAdminDb().collection("user_connections").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    const notion_token = d.notion_token as string | undefined;
    const notion_database_id = d.notion_database_id as string | undefined;
    if (!notion_token || !notion_database_id) return null;
    return { notion_token, notion_database_id };
  } catch (err) {
    logger.error({ err, uid }, "getNotionCredsByAdmin failed");
    return null;
  }
}

export async function saveModelPreferenceByAdmin(uid: string, model: string): Promise<void> {
  if (!isAdminReady()) return;
  await getAdminDb().collection("user_connections").doc(uid).update({ ai_model: model });
}

/* ─────────────────────────────────────────────────────────────
   RETRY HELPER
───────────────────────────────────────────────────────────── */

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 600,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg === "invalid_key" ||
        msg.startsWith("auth_error:") ||
        msg.startsWith("model_not_found")
      ) throw err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

/* ─────────────────────────────────────────────────────────────
   VOICE TRANSCRIPTION
───────────────────────────────────────────────────────────── */

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
]);

// Max base64 payload: ~40 MB covers a 5-minute compressed WebM recording (~30 MB raw)
export const VOICE_MAX_BASE64_BYTES = 40 * 1024 * 1024;

export type DetectedLanguage = "myanmar" | "english" | "mixed" | "unknown";

export interface TranscriptionResult {
  transcript: string;
  detectedLanguage: DetectedLanguage;
}

export async function transcribeAudio(
  config: AIConfig,
  audioBase64: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  const cleanMime = mimeType.split(";")[0].trim().toLowerCase();

  if (config.provider === "gemini") {
    const model = config.model;
    const body = {
      contents: [{
        parts: [
          {
            text: [
              "Transcribe this audio exactly as spoken. Do not translate — preserve the original language.",
              "After the transcript, on a new line write exactly one of:",
              "LANG:myanmar",
              "LANG:english",
              "LANG:mixed",
              "Output only the transcript text followed by the LANG line. Nothing else.",
            ].join("\n"),
          },
          { inlineData: { mimeType: cleanMime, data: audioBase64 } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const controller = new AbortController();
    // 5-minute timeout for long recordings
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 429) throw new Error(`GEMINI_RATE_LIMIT:${errText.slice(0, 100)}`);
        throw new Error(`TRANSCRIPTION_FAILED:Gemini error (${resp.status}): ${errText.slice(0, 200)}`);
      }
      const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      const langMatch = raw.match(/\nLANG:(myanmar|english|mixed)\s*$/i);
      const detectedLanguage = (langMatch?.[1]?.toLowerCase() ?? "unknown") as DetectedLanguage;
      const transcript = langMatch
        ? raw.slice(0, raw.lastIndexOf("\nLANG:")).trim()
        : raw;
      return { transcript, detectedLanguage };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("AbortError")) {
        throw new Error("NETWORK_TIMEOUT:Gemini timed out processing the audio.");
      }
      throw err;
    }
  }

  if (config.provider === "openai") {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const ext = cleanMime === "audio/ogg" ? "ogg"
      : cleanMime === "audio/mpeg" || cleanMime === "audio/mp3" ? "mp3"
      : cleanMime === "audio/wav" ? "wav"
      : cleanMime === "audio/webm" ? "webm"
      : "m4a";
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${cleanMime}\r\n\r\n`),
      audioBuffer,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1` +
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json` +
        `\r\n--${boundary}--\r\n`,
      ),
    ]);
    const controller = new AbortController();
    // 5-minute timeout for long recordings
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 429) throw new Error(`OPENAI_RATE_LIMIT:${errText.slice(0, 100)}`);
        throw new Error(`TRANSCRIPTION_FAILED:OpenAI Whisper error (${resp.status}): ${errText.slice(0, 200)}`);
      }
      const data = (await resp.json()) as { text?: string; language?: string };
      const lang = data.language?.toLowerCase();
      const detectedLanguage: DetectedLanguage =
        lang === "burmese" || lang === "myanmar" ? "myanmar"
        : lang === "english" ? "english"
        : "unknown";
      return { transcript: data.text?.trim() ?? "", detectedLanguage };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("AbortError")) {
        throw new Error("NETWORK_TIMEOUT:OpenAI timed out processing the audio.");
      }
      throw err;
    }
  }

  throw new Error("TRANSCRIPTION_FAILED:Voice transcription requires Gemini or OpenAI provider");
}
