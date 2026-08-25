import { get, setex } from "./redis.js";
import { logger } from "./logger.js";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

const TTL_SECONDS = 2 * 60 * 60;
const MAX_MESSAGES = 20;

function key(uid: string) { return `session:${uid}`; }

/** Shared AI conversation memory for all authenticated web input surfaces. */
export async function loadSessionMessages(uid: string): Promise<SessionMessage[]> {
  const raw = await get(key(uid));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is SessionMessage =>
      !!m && typeof m === "object" &&
      ((m as SessionMessage).role === "user" || (m as SessionMessage).role === "assistant") &&
      typeof (m as SessionMessage).content === "string",
    ).slice(-MAX_MESSAGES);
  } catch {
    logger.warn({ uid }, "Discarding malformed AI session memory");
    return [];
  }
}

export async function appendSessionMessages(uid: string, messages: SessionMessage[]): Promise<void> {
  const existing = await loadSessionMessages(uid);
  const next = [...existing, ...messages].slice(-MAX_MESSAGES);
  await setex(key(uid), TTL_SECONDS, JSON.stringify(next));
}
