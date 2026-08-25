import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Server start time for uptime calculation ───────────────────────────────
const SERVER_START = Date.now();

// ─── Wakeup state: separate internal vs external pings ──────────────────────
interface WakeupState {
  serverStatus: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
  internalPingCount: number;
  lastInternalPing: string | null;
  externalPingCount: number;
  lastExternalPing: string | null;
  lastExternalResponseMs: number | null;
  lastWebhookReceived: string | null;
  webhookUpdateCount: number;
  lastError: string | null;
}

const state: WakeupState = {
  serverStatus: "ONLINE",
  internalPingCount: 0,
  lastInternalPing: new Date().toISOString(),
  externalPingCount: 0,
  lastExternalPing: null,
  lastExternalResponseMs: null,
  lastWebhookReceived: null,
  webhookUpdateCount: 0,
  lastError: null,
};

// ─── Exported so telegram router can record real webhook activity ─────────────
export function recordWebhookUpdate(): void {
  state.lastWebhookReceived = new Date().toISOString();
  state.webhookUpdateCount += 1;
}

// ─── Internal self-ping: just marks liveness, no fake HTTP timing ────────────
function selfPing(): void {
  state.internalPingCount += 1;
  state.lastInternalPing = new Date().toISOString();
  state.serverStatus = "ONLINE";
  state.lastError = null;
  logger.info({ internalPingCount: state.internalPingCount }, "Wakeup self-ping");
}

// Self-ping every 60 seconds to keep the event loop warm
setInterval(selfPing, 60 * 1000);

// ─── Build full status payload ────────────────────────────────────────────────
function buildStatus() {
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START) / 1000);
  const mem = process.memoryUsage();
  return {
    serverStatus: state.serverStatus,
    uptimeSeconds,
    uptimeHuman: formatUptime(uptimeSeconds),
    memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
    memoryRssMB: Math.round(mem.rss / 1024 / 1024),
    // Internal self-pings (confirms Node process is alive, NOT an external check)
    internalPingCount: state.internalPingCount,
    lastInternalPing: state.lastInternalPing,
    // External pings from UptimeRobot / cron-job.org / GitHub Actions
    externalPingCount: state.externalPingCount,
    lastExternalPing: state.lastExternalPing,
    lastExternalResponseMs: state.lastExternalResponseMs,
    // Telegram webhook activity
    lastWebhookReceived: state.lastWebhookReceived,
    webhookUpdateCount: state.webhookUpdateCount,
    // Legacy field for backwards compat
    lastSuccessfulPing: state.lastExternalPing ?? state.lastInternalPing,
    lastError: state.lastError,
    externalPingerConfigured: state.externalPingCount > 0,
    externalPingerHint: state.externalPingCount === 0
      ? "No external pings yet. Configure UptimeRobot or cron-job.org to POST /api/wakeup/ping every 60s."
      : null,
  };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// READ-ONLY — does NOT mutate state, no fake "just pinged" pollution
router.get("/wakeup/status", (_req, res) => {
  res.json(buildStatus());
});

// External GET ping (UptimeRobot free tier)
router.get("/wakeup/ping", (req, res) => {
  const start = Date.now();
  state.externalPingCount += 1;
  state.lastExternalPing = new Date().toISOString();
  state.lastExternalResponseMs = Date.now() - start;
  state.serverStatus = "ONLINE";
  state.lastError = null;
  logger.info({ externalPingCount: state.externalPingCount, ip: req.ip }, "External GET wakeup ping");
  res.json({ ok: true, responseMs: state.lastExternalResponseMs });
});

// External POST ping (cron-job.org, GitHub Actions)
router.post("/wakeup/ping", (req, res) => {
  const start = Date.now();
  state.externalPingCount += 1;
  state.lastExternalPing = new Date().toISOString();
  state.lastExternalResponseMs = Date.now() - start;
  state.serverStatus = "ONLINE";
  state.lastError = null;
  logger.info({ externalPingCount: state.externalPingCount, ip: req.ip }, "External POST wakeup ping");
  res.json({ ok: true, responseMs: state.lastExternalResponseMs });
});

export default router;
