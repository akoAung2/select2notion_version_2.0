import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// 50 MB limit — audio base64 for a 5-minute recording can be 10-30 MB
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

// ── Static frontend (production) ──────────────────────────────────────────
// The frontend is built to artifacts/trading-journal/dist/public.
// In production the run command executes from the workspace root, so we
// resolve relative to process.cwd(). Falls back to __dirname-relative path
// for any edge-case working-directory differences.
const staticCandidates = [
  path.resolve(process.cwd(), "artifacts/trading-journal/dist/public"),
  path.resolve(__dirname, "../../trading-journal/dist/public"),
];
const staticDir = staticCandidates.find((p) => fs.existsSync(p));

if (staticDir) {
  logger.info({ staticDir }, "Serving frontend static files");
  app.use(express.static(staticDir));
  // Guard: unmatched /api/* GETs must return a JSON 404, not the SPA shell.
  app.use("/api/{*path}", (_req, res) => {
    res.status(404).json({ ok: false, error: "Not found" });
  });
  // SPA fallback — return index.html for any other unmatched GET (React Router handles routing).
  // Express 5 + path-to-regexp 8 require named wildcards; bare "*" is rejected.
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn(
    "Frontend static files not found — API-only mode (run the frontend build to enable full UI)",
  );
}

export default app;
