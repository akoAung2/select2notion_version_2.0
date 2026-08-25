import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notionRouter from "./notion";
import aiRouter from "./ai";
import telegramRouter, { startTelegramBot } from "./telegram";
import wakeupRouter from "./wakeup";
import newsRouter from "./news";
import { startScheduler } from "../scheduler/cron";
import { ping } from "../lib/redis.js";
import { startAIWorker } from "../workers/aiWorker.js";

const router: IRouter = Router();

// Deployment healthcheck — GET /api (root) must return 200 for Replit autoscale health probe
router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "select2notion-api", timestamp: new Date().toISOString() });
});

router.use(healthRouter);
router.use(wakeupRouter);
router.use(telegramRouter);
router.use(notionRouter);
router.use(aiRouter);
router.use(newsRouter);

startTelegramBot();
startScheduler();

// ── Redis + AI Worker boot ─────────────────────────────────────────────────
// Ping Redis on startup to set the isRedisReady() flag.
// The AI worker starts polling only after ping confirms connectivity.
ping().then((ok) => {
  if (ok) {
    startAIWorker();
  } else {
    // isRedisReady() returns false — event engine falls back to inline processing automatically
  }
});

export default router;
