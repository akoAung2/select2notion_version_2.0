import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isRedisReady, getRedisLatencyMs, ping } from "../lib/redis.js";
import { getWorkerStats } from "../workers/aiWorker.js";

const router: IRouter = Router();

// Root health — used by Replit deployment healthcheck at GET /api
router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "select2notion-api", timestamp: new Date().toISOString() });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Redis health — GET /api/health/redis */
router.get("/health/redis", async (_req, res) => {
  const ready = isRedisReady();
  // Re-ping for live latency measurement
  const ok = await ping();
  res.json({
    ok,
    connected: ok,
    latencyMs: getRedisLatencyMs(),
    worker: getWorkerStats(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
