/**
 * Telegram Broadcast Service
 * Per-user filtering: impact, timing, currency
 */

import { logger } from "../lib/logger.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export interface BroadcastOptions {
  alertType?: "warning";
  minutesBefore?: number;
  impact?: "high" | "medium" | "low";
  currency?: string;
}

export async function broadcastTelegramMessage(
  message: string,
  opts: BroadcastOptions = {},
): Promise<number> {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — skipping broadcast");
    return 0;
  }
  if (!isAdminReady()) return 0;

  let sentCount = 0;
  try {
    const snap = await getAdminDb().collection("telegram_connections").get();
    if (snap.empty) return 0;

    await Promise.allSettled(
      snap.docs.map(async (doc) => {
        const data = doc.data() as { chatId?: number | string };
        // uid is the document ID — the data object never contains a uid field
        const chatId = data.chatId;
        const uid = doc.id;
        if (!chatId) return;

        if (uid) {
          const allowed = await checkUserAllowed(uid, opts);
          if (!allowed) return;
        }

        try {
          await sendTelegramMessage(chatId, message);
          sentCount++;
        } catch (err) {
          logger.warn({ err, chatId }, "Failed to send Telegram message to user");
        }
      }),
    );
  } catch (err) {
    logger.error({ err }, "Broadcast error");
  }

  logger.info({ sentCount }, "Telegram broadcast complete");
  return sentCount;
}

/** Exported for use by the AI worker — same logic as internal checkUserAllowed. */
export async function checkUserAllowedPublic(uid: string, opts: BroadcastOptions): Promise<boolean> {
  return checkUserAllowed(uid, opts);
}

async function checkUserAllowed(uid: string, opts: BroadcastOptions): Promise<boolean> {
  try {
    const settingsDoc = await getAdminDb().collection("user_settings").doc(uid).get();
    if (!settingsDoc.exists) return true;

    const data = settingsDoc.data() ?? {};

    // Impact filter
    if (opts.impact && data.news_filters?.impact) {
      const allowedImpacts: string[] = data.news_filters.impact;
      if (allowedImpacts.length > 0 && !allowedImpacts.includes(opts.impact.toUpperCase())) {
        return false;
      }
    }

    // Currency filter
    if (opts.currency && data.news_filters?.currency) {
      const allowedCurrencies: string[] = data.news_filters.currency;
      if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(opts.currency.toUpperCase())) {
        return false;
      }
    }

    // Warning timing filter
    if (opts.alertType === "warning" && opts.minutesBefore !== undefined) {
      const timings: number[] = data.telegram?.news_alert_timing ?? [60, 30, 15, 5, 1];
      if (!timings.includes(opts.minutesBefore)) {
        return false;
      }
    }

    return true;
  } catch {
    return true;
  }
}

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Telegram API error: ${resp.status} — ${err}`);
  }
}

export async function logTelegramAlert(
  type: "warning" | "release",
  eventName: string,
  message: string,
): Promise<void> {
  if (!isAdminReady()) return;
  try {
    await getAdminDb().collection("telegram_logs").add({
      type,
      eventName,
      message: message.slice(0, 1000),
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 24 * 3600_000), // 3-day retention per spec
    });
  } catch (err) {
    logger.error({ err }, "Failed to log Telegram alert");
  }
}

export async function getRecentTelegramLogs(limit = 20): Promise<Array<Record<string, unknown>>> {
  if (!isAdminReady()) return [];
  try {
    const snap = await getAdminDb()
      .collection("telegram_logs")
      .orderBy("sentAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    logger.error({ err }, "Failed to load Telegram logs");
    return [];
  }
}
