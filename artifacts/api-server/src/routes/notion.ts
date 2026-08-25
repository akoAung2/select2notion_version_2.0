import { Router } from "express";
import { Client } from "@notionhq/client";
import { Resend } from "resend";
import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { requireAuth, getUserNotionCredentials } from "../middleware/auth.js";
import { getAdminDb, isAdminReady } from "../lib/firebaseAdmin.js";
import { clearCachedSchema } from "../lib/schemaCache.js";
import { normalizeDbId } from "../lib/aiEngine.js";
import { fromNotionPage } from "../lib/notion/tradeMapper.js";
import { buildPropertyDefinition } from "../lib/notion/propertyConfig.js";

const router = Router();

function makeNotionClient(token: string) {
  return new Client({ auth: token, notionVersion: "2022-06-28" });
}

const EXPECTED_SCHEMA: Record<string, string[]> = {
  "Name": ["title"],
  "Date": ["date"],
  "Profit/Loss": ["number", "formula"],
  "Session": ["select", "rich_text"],
  "Pairs": ["multi_select", "select", "rich_text"],
  "Direction": ["select", "rich_text"],
  "Emotion": ["select", "rich_text"],
  "Entry": ["files", "rich_text"],
};

function getDatabaseTitle(db: any): string {
  const titleArr = db.title as any[];
  return titleArr?.map((t: any) => t.plain_text).join("") || "Untitled";
}

interface FingerprintResult {
  database_id: string;
  title: string;
  score: number;
  matched_fields: string[];
  missing_fields: string[];
}

function fingerprintDatabase(db: any): FingerprintResult {
  const props = db.properties || {};
  const propNames = Object.keys(props);
  const matched_fields: string[] = [];
  const missing_fields: string[] = [];
  let score = 0;
  const pointsPerField = 100 / Object.keys(EXPECTED_SCHEMA).length;

  for (const [name, allowedTypes] of Object.entries(EXPECTED_SCHEMA)) {
    if (propNames.includes(name)) {
      const propType = props[name]?.type;
      if (allowedTypes.includes(propType)) {
        score += pointsPerField;
        matched_fields.push(name);
      } else {
        score += pointsPerField * 0.5;
        matched_fields.push(`${name} (type mismatch)`);
      }
    } else {
      missing_fields.push(name);
    }
  }

  return {
    database_id: db.id,
    title: getDatabaseTitle(db),
    score: Math.round(Math.min(score, 100)),
    matched_fields,
    missing_fields,
  };
}

async function signOAuthState(uid: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured — cannot sign OAuth state");
  const payload = JSON.stringify({ uid, exp: Date.now() + 10 * 60 * 1000 });
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "utf-8"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, Buffer.from(payload, "utf-8"));
  return `${Buffer.from(payload).toString("base64url")}.${Buffer.from(sig).toString("base64url")}`;
}

async function verifyOAuthState(state: string): Promise<string> {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) throw new Error("Malformed state");
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured — cannot verify OAuth state");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "utf-8"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    Buffer.from(sigB64, "base64url"),
    Buffer.from(payloadB64, "base64url"),
  );
  if (!valid) throw new Error("Invalid state signature");
  const { uid, exp } = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  if (Date.now() > exp) throw new Error("State expired");
  return uid as string;
}

function getOAuthRedirectUri(req: any): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) return `https://${domains}/api/notion/oauth/callback`;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["host"];
  return `${proto}://${host}/api/notion/oauth/callback`;
}

const pendingOAuthConnections = new Map<
  string,
  { access_token: string; workspace_name: string; workspace_id: string; bot_id: string }
>();

router.get("/notion/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  const closeWindowHtml = (success: boolean, message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TradeEdge — Notion Connect</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;padding:1rem}
.card{text-align:center;padding:2rem 1.75rem;border-radius:1.25rem;background:white;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:380px;width:100%}
.icon{font-size:3rem;margin-bottom:1rem;display:block}
h2{font-size:1.35rem;font-weight:800;margin-bottom:.5rem;color:${success ? "#059669" : "#dc2626"}}
.msg{color:#64748b;font-size:.9rem;line-height:1.55;margin-bottom:1.5rem}
.btn{display:flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:1rem 1.5rem;border-radius:.875rem;border:none;cursor:pointer;font-size:1rem;font-weight:700;background:${success ? "#059669" : "#64748b"};color:white;transition:opacity .15s,transform .1s;-webkit-tap-highlight-color:transparent}
.btn:hover{opacity:.9}
.btn:active{transform:scale(.98)}
.hint{font-size:.75rem;color:#94a3b8;margin-top:.875rem;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <span class="icon">${success ? "✅" : "❌"}</span>
  <h2>${success ? "Notion Connected!" : "Connection Failed"}</h2>
  <p class="msg">${message}</p>
  <button class="btn" id="closeBtn" onclick="handleClose()">
    ${success ? "↩ Return to App" : "✕ Close Window"}
  </button>
  <p class="hint" id="hint">${success ? "This window will close automatically. If it doesn't, tap the button above." : ""}</p>
</div>
<script>
  function handleClose() {
    try { window.close(); } catch(e) {}
    setTimeout(function() {
      document.getElementById('hint').textContent = 'Please close this tab manually and return to the app.';
      document.getElementById('closeBtn').textContent = '✕ Close This Tab';
    }, 400);
  }

  (function() {
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'notion-oauth-done', success: ${success} }, '*');
      }
    } catch(e) {}
    if (${success}) {
      setTimeout(function() { try { window.close(); } catch(e) {} }, 1500);
    }
  })();
</script>
</body>
</html>`;

  if (error) {
    res.send(closeWindowHtml(false, `Notion returned an error: ${error}`));
    return;
  }

  if (!code || !state) {
    res.send(closeWindowHtml(false, "Missing code or state parameter."));
    return;
  }

  try {
    const uid = await verifyOAuthState(state);
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.send(closeWindowHtml(false, "OAuth not configured on the server."));
      return;
    }

    const tokenResp = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: getOAuthRedirectUri(req),
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ err }, "Notion token exchange failed");
      res.send(closeWindowHtml(false, "Failed to exchange token with Notion."));
      return;
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      workspace_name?: string;
      workspace_id?: string;
      bot_id?: string;
    };

    pendingOAuthConnections.set(uid, {
      access_token: tokenData.access_token,
      workspace_name: tokenData.workspace_name || "",
      workspace_id: tokenData.workspace_id || "",
      bot_id: tokenData.bot_id || "",
    });

    logger.info({ uid, workspace: tokenData.workspace_name }, "Notion OAuth completed");
    res.send(closeWindowHtml(true, `Workspace "${tokenData.workspace_name || "Unknown"}" connected. This window will close automatically.`));
  } catch (err) {
    logger.error({ err }, "Notion OAuth callback error");
    res.send(closeWindowHtml(false, "An error occurred. Please try again."));
  }
});

// Path-specific auth guard — only protects routes this router owns.
// A catch-all router.use(requireAuth) would intercept paths meant for
// other routers (e.g. /telegram/webhook) since routers are mounted without
// path prefixes and Express processes them in order.
router.use(
  [
    "/notion/oauth/start",
    "/notion/oauth/pending",
    "/notion/auto-detect",
    "/notion/schema",
    "/notion/test",
    "/notion/properties",
    "/notion/property-options",
    "/notion/verify-page",
    "/trades",
    "/notification-settings",
    "/trigger-daily",
    "/trigger-weekly",
  ],
  requireAuth,
);

/* ─── Notification settings helpers (Firestore-backed) ─── */

interface NotifSettings { email: string; type: "daily" | "weekly" | "off" }

async function saveNotifSettings(uid: string, settings: NotifSettings): Promise<void> {
  if (!isAdminReady()) return;
  await getAdminDb().collection("notification_settings").doc(uid).set(settings, { merge: true });
}

async function loadNotifSettings(uid: string): Promise<NotifSettings | null> {
  if (!isAdminReady()) return null;
  const snap = await getAdminDb().collection("notification_settings").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as NotifSettings;
}

async function sendDailyEmail(uid: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !isAdminReady()) return;
  const settings = await loadNotifSettings(uid);
  if (!settings || settings.type !== "daily" || !settings.email) return;
  try {
    const d = (await getAdminDb().collection("user_connections").doc(uid).get()).data() ?? {};
    const notion_token = d.notion_token as string | undefined;
    const notion_database_id = d.notion_database_id as string | undefined;
    if (!notion_token || !notion_database_id) return;
    const notion = makeNotionClient(notion_token);
    const today = new Date().toISOString().split("T")[0];
    const response: any = await notion.request({
      path: `databases/${normalizeDbId(notion_database_id)}/query`, method: "post",
      body: { filter: { property: "Date", date: { equals: today } } },
    });
    if (response.results.length === 0) {
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: settings.email,
        subject: "Reminder: Log your trade today",
        html: "<p>You haven't logged any trades today. Stay consistent.</p>",
      });
      logger.info({ uid }, "Daily reminder email sent");
    }
  } catch (err) { logger.error({ err, uid }, "Daily reminder error"); }
}

async function sendWeeklyEmail(uid: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !isAdminReady()) return;
  const settings = await loadNotifSettings(uid);
  if (!settings || settings.type !== "weekly" || !settings.email) return;
  try {
    const d = (await getAdminDb().collection("user_connections").doc(uid).get()).data() ?? {};
    const notion_token = d.notion_token as string | undefined;
    const notion_database_id = d.notion_database_id as string | undefined;
    if (!notion_token || !notion_database_id) return;
    const notion = makeNotionClient(notion_token);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const response: any = await notion.request({
      path: `databases/${normalizeDbId(notion_database_id)}/query`, method: "post",
      body: { filter: { property: "Date", date: { on_or_after: sevenDaysAgo.toISOString().split("T")[0] } } },
    });
    const trades = response.results.map(fromNotionPage);
    const totalPnL = trades.reduce((s: number, t: any) => s + (Number(t["Profit/Loss"]) || 0), 0);
    const winRate = trades.length > 0
      ? ((trades.filter((t: any) => (Number(t["Profit/Loss"]) || 0) > 0).length / trades.length) * 100).toFixed(1)
      : "0.0";
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: settings.email,
      subject: "Weekly Trading Report",
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#7C3AED">Weekly Performance</h2><p>Trades: ${trades.length} | PnL: $${totalPnL.toFixed(2)} | Win Rate: ${winRate}%</p></div>`,
    });
    logger.info({ uid }, "Weekly report email sent");
  } catch (err) { logger.error({ err, uid }, "Weekly report error"); }
}

async function runCronForAllUsers(type: "daily" | "weekly"): Promise<void> {
  if (!isAdminReady()) { logger.warn("Cron skipped — Firebase Admin not ready"); return; }
  const snap = await getAdminDb().collection("notification_settings").where("type", "==", type).get();
  logger.info({ type, userCount: snap.size }, "Cron running for users");
  await Promise.allSettled(snap.docs.map((doc) =>
    type === "daily" ? sendDailyEmail(doc.id) : sendWeeklyEmail(doc.id),
  ));
}

router.get("/notion/oauth/start", async (req, res) => {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    res.json({ oauthAvailable: false });
    return;
  }
  try {
    const state = await signOAuthState(req.uid!);
    const redirectUri = getOAuthRedirectUri(req);
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    res.json({ oauthAvailable: true, url: url.toString() });
  } catch (err) {
    req.log.error({ err }, "Failed to generate OAuth URL");
    res.json({ oauthAvailable: false });
  }
});

router.get("/notion/oauth/pending", (req, res) => {
  const pending = pendingOAuthConnections.get(req.uid!);
  if (!pending) {
    res.status(404).json({ error: "No pending OAuth connection found" });
    return;
  }
  pendingOAuthConnections.delete(req.uid!);
  res.json(pending);
});

router.post("/notion/auto-detect", async (req, res) => {
  const { notion_token } = req.body as { notion_token?: string };
  if (!notion_token) {
    res.status(400).json({ status: "no_match", all: [], message: "notion_token is required" });
    return;
  }

  try {
    const notion = makeNotionClient(notion_token);

    let allDbs: any[] = [];
    let cursor: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result: any = await notion.search({
        filter: { value: "database", property: "object" } as any,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      allDbs = allDbs.concat(result.results);
      if (!result.has_more) break;
      cursor = result.next_cursor;
    }

    if (allDbs.length === 0) {
      res.json({ status: "no_match", all: [], message: "No databases found in this workspace." });
      return;
    }

    const matches = allDbs
      .map((db: any) => fingerprintDatabase(db))
      .sort((a, b) => b.score - a.score);

    const best = matches[0];
    const HIGH_CONFIDENCE = 75;
    const AMBIGUOUS_THRESHOLD = 10;

    if (best.score < HIGH_CONFIDENCE) {
      res.json({
        status: "no_match",
        all: matches,
        message: `No database closely matches the TradeEdge template (best score: ${best.score}%). Please connect manually.`,
      });
      return;
    }

    const closeMatches = matches.filter((m) => m.score >= HIGH_CONFIDENCE - AMBIGUOUS_THRESHOLD);
    if (closeMatches.length > 1) {
      res.json({
        status: "multiple",
        best,
        all: matches,
        message: `Found ${closeMatches.length} possible databases. Please confirm which one to use.`,
      });
      return;
    }

    res.json({
      status: "matched",
      best,
      all: matches,
      message: `✅ Auto-detected "${best.title}" with ${best.score}% confidence`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Auto-detect error");
    res.status(500).json({
      status: "no_match",
      all: [],
      message: err.message || "Failed to scan workspace",
    });
  }
});

router.get("/notion/schema", async (req, res) => {
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) {
      res.status(400).json({ error: "Notion not connected." });
      return;
    }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const response: any = await notion.databases.retrieve({ database_id: dbId });
    res.json({ schema: response.properties });
  } catch (error: any) {
    req.log.error({ err: error }, "Schema Fetch Error");
    res.status(error.status || 500).json({ error: error.message, details: error.body });
  }
});

router.get("/trades", async (req, res) => {
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) {
      res.json({ trades: [] });
      return;
    }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);

    let allResults: any[] = [];
    let cursor: string | undefined;
    do {
      const response: any = await notion.request({
        path: `databases/${dbId}/query`,
        method: "post",
        body: {
          sorts: [{ property: "Date", direction: "ascending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
      });
      allResults = allResults.concat(response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    res.json({ trades: allResults.map(fromNotionPage) });
  } catch (error: any) {
    req.log.error({ err: error }, "Notion Query Error");
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
});

router.post("/trades", async (req, res) => {
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) {
      res.status(400).json({ error: "Notion not connected." });
      return;
    }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const trade = req.body;
    const properties: any = {};
    const dbResponse: any = await notion.databases.retrieve({ database_id: dbId });
    const schema = dbResponse.properties;

    for (const [key, value] of Object.entries(trade)) {
      if (value === undefined || value === null || value === "") continue;
      const propSchema = schema[key];
      if (!propSchema) continue;
      const type = propSchema.type;
      switch (type) {
        case "title": properties[key] = { title: [{ text: { content: String(value) } }] }; break;
        case "rich_text": properties[key] = { rich_text: [{ text: { content: String(value) } }] }; break;
        case "number": properties[key] = { number: Number(value) }; break;
        case "select": properties[key] = { select: { name: String(value) } }; break;
        case "multi_select": {
          const names = Array.isArray(value) ? (value as string[]) : String(value).split(",").map((s) => s.trim());
          properties[key] = { multi_select: names.map((name) => ({ name })) };
          break;
        }
        case "checkbox": properties[key] = { checkbox: value === "Yes" || value === true || value === "true" }; break;
        case "date": properties[key] = { date: { start: String(value) } }; break;
        case "files": {
          const urls = Array.isArray(value)
            ? (value as string[])
            : String(value).split(",").map((s) => s.trim()).filter(Boolean);
          properties[key] = { files: urls.map((url, i) => ({ name: `Chart ${i + 1}`, type: "external", external: { url } })) };
          break;
        }
      }
    }

    const response = await notion.pages.create({ parent: { database_id: dbId } as any, properties });
    res.status(201).json(fromNotionPage(response));
  } catch (error: any) {
    req.log.error({ err: error }, "Notion Create Error");
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
});

router.patch("/trades/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) {
      res.status(400).json({ error: "Notion not connected." });
      return;
    }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const trade = req.body;
    const properties: any = {};
    const dbResponse: any = await notion.databases.retrieve({ database_id: dbId });
    const schema = dbResponse.properties;

    for (const [key, value] of Object.entries(trade)) {
      if (value === undefined || value === null || value === "") continue;
      const propSchema = schema[key];
      if (!propSchema) continue;
      const type = propSchema.type;
      switch (type) {
        case "title": properties[key] = { title: [{ text: { content: String(value) } }] }; break;
        case "rich_text": properties[key] = { rich_text: [{ text: { content: String(value) } }] }; break;
        case "number": properties[key] = { number: Number(value) }; break;
        case "select": properties[key] = { select: { name: String(value) } }; break;
        case "multi_select": {
          const names = Array.isArray(value) ? (value as string[]) : String(value).split(",").map((s) => s.trim()).filter(Boolean);
          properties[key] = { multi_select: names.map((name) => ({ name })) };
          break;
        }
        case "checkbox": properties[key] = { checkbox: value === "Yes" || value === true || value === "true" }; break;
        case "date": properties[key] = { date: { start: String(value) } }; break;
        case "files": {
          const urls = Array.isArray(value)
            ? (value as string[])
            : String(value).split(",").map((s) => s.trim()).filter(Boolean);
          properties[key] = { files: urls.map((url, i) => ({ name: `Chart ${i + 1}`, type: "external", external: { url } })) };
          break;
        }
      }
    }

    const response = await notion.pages.update({ page_id: id, properties });
    res.json(fromNotionPage(response));
  } catch (error: any) {
    req.log.error({ err: error }, "Notion Update Error");
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
});

router.delete("/trades/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) {
      res.status(400).json({ error: "Notion not connected." });
      return;
    }
    const notion = makeNotionClient(creds.notion_token);
    await notion.pages.update({ page_id: id, archived: true });
    res.json({ success: true });
  } catch (error: any) {
    req.log.error({ err: error }, "Notion Delete Error");
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
});

router.post("/notion/test", async (req, res) => {
  try {
    const { apiKey, databaseId } = req.body as { apiKey?: string; databaseId?: string };
    if (!apiKey || !databaseId) {
      res.status(400).json({ status: "ERROR", message: "API Key and Database ID are required" });
      return;
    }
    const testNotion = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
    const dbId = normalizeDbId(databaseId);
    const response: any = await testNotion.databases.retrieve({ database_id: dbId });
    const props = Object.keys(response.properties || {});
    const required = ["Name", "Date", "Profit/Loss"];
    const missing = required.filter((r) => !props.includes(r));
    if (missing.length > 0) {
      res.json({ status: "ERROR", message: `❌ Invalid Database Template — missing: ${missing.join(", ")}` });
      return;
    }
    const titleArr = response.title as any[];
    const dbTitle = titleArr?.[0]?.plain_text || "Untitled";
    res.json({ status: "OK", message: `✅ Connected to "${dbTitle}" — ${props.length} properties found` });
  } catch (error: any) {
    req.log.error({ err: error }, "Notion Test Error");
    const msg = error.status === 401 ? "❌ Invalid Notion Token"
      : error.status === 404 ? "❌ Database Not Found or Access Denied"
      : `❌ ${error.message || "Connection failed"}`;
    res.status(error.status || 500).json({ status: "ERROR", message: msg });
  }
});

router.get("/notification-settings", async (req, res) => {
  const settings = (await loadNotifSettings(req.uid!)) ?? { email: "", type: "off" };
  res.json(settings);
});

router.post("/notification-settings", async (req, res) => {
  const { email, type } = req.body as { email?: string; type?: string };
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }
  const s: NotifSettings = { email, type: (type as NotifSettings["type"]) || "off" };
  await saveNotifSettings(req.uid!, s);
  res.json({ message: "Settings saved successfully" });
});

router.post("/trigger-daily", async (req, res) => {
  await sendDailyEmail(req.uid!);
  res.json({ message: "Daily reminder check triggered" });
});

router.post("/trigger-weekly", async (req, res) => {
  await sendWeeklyEmail(req.uid!);
  res.json({ message: "Weekly report check triggered" });
});

cron.schedule("0 9 * * *", () => {
  logger.info("Daily cron tick — running for all users");
  runCronForAllUsers("daily").catch((err) => logger.error({ err }, "Daily cron error"));
});
cron.schedule("0 18 * * 0", () => {
  logger.info("Weekly cron tick — running for all users");
  runCronForAllUsers("weekly").catch((err) => logger.error({ err }, "Weekly cron error"));
});

/* ─────────────────────────────────────────────────────────────
   PROPERTY MANAGEMENT
───────────────────────────────────────────────────────────── */

router.post("/notion/properties", async (req, res) => {
  const { name, propertyType } = req.body as { name?: string; propertyType?: string };
  if (!name || !propertyType) {
    res.status(400).json({ success: false, message: "name and propertyType are required" });
    return;
  }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const propertyDef = buildPropertyDefinition(name, propertyType);
    await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: propertyDef } });
    res.json({ success: true, message: `Property "${name}" created successfully!` });
  } catch (error: any) {
    req.log.error({ err: error }, "Create Property Error");
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create property" });
  }
});

router.patch("/notion/properties/:propertyId", async (req, res) => {
  const { newName } = req.body as { newName?: string };
  const { propertyId } = req.params;
  if (!newName) {
    res.status(400).json({ success: false, message: "newName is required" });
    return;
  }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    await notion.request({ path: `databases/${dbId}`, method: "patch", body: { properties: { [propertyId]: { name: newName } } } });
    res.json({ success: true, message: `Property renamed to "${newName}" successfully!` });
  } catch (error: any) {
    req.log.error({ err: error }, "Update Property Error");
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update property" });
  }
});

/* ─────────────────────────────────────────────────────────────
   OPTION MANAGER — add / rename / delete select options
───────────────────────────────────────────────────────────── */

const OPTION_TYPES = new Set(["select", "multi_select", "status"]);

router.post("/notion/property-options", async (req, res) => {
  const { propertyName, optionName } = req.body as { propertyName?: string; optionName?: string };
  if (!propertyName || !optionName) {
    res.status(400).json({ success: false, message: "propertyName and optionName are required" });
    return;
  }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const db: any = await notion.databases.retrieve({ database_id: dbId });
    const prop = db.properties[propertyName];
    if (!prop || !OPTION_TYPES.has(prop.type)) {
      res.status(400).json({ success: false, message: `Property "${propertyName}" is not a select/multi_select/status` });
      return;
    }
    const propType = prop.type as "select" | "multi_select" | "status";
    const existing: Array<{ id: string; name: string; color?: string }> = prop[propType]?.options || [];
    if (existing.some((o) => o.name.toLowerCase() === optionName.toLowerCase())) {
      res.status(400).json({ success: false, message: `Option "${optionName}" already exists` });
      return;
    }
    const updatedOptions = [...existing.map((o) => ({ id: o.id, name: o.name })), { name: optionName }];
    const body = propType === "status"
      ? { properties: { [propertyName]: { status: { options: updatedOptions, groups: prop.status?.groups || [] } } } }
      : { properties: { [propertyName]: { [propType]: { options: updatedOptions } } } };
    await notion.request({ path: `databases/${dbId}`, method: "patch", body });
    clearCachedSchema(req.uid!);
    req.log.info({ propertyName, optionName }, "Option added");
    res.json({ success: true, message: `Option "${optionName}" added to "${propertyName}"` });
  } catch (error: any) {
    req.log.error({ err: error }, "Add Option Error");
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to add option" });
  }
});

router.patch("/notion/property-options", async (req, res) => {
  const { propertyName, optionId, newName } = req.body as { propertyName?: string; optionId?: string; newName?: string };
  if (!propertyName || !optionId || !newName) {
    res.status(400).json({ success: false, message: "propertyName, optionId, and newName are required" });
    return;
  }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const db: any = await notion.databases.retrieve({ database_id: dbId });
    const prop = db.properties[propertyName];
    if (!prop || !OPTION_TYPES.has(prop.type)) {
      res.status(400).json({ success: false, message: `Property "${propertyName}" is not a select/multi_select/status` });
      return;
    }
    const propType = prop.type as "select" | "multi_select" | "status";
    const existing: Array<{ id: string; name: string; color?: string }> = prop[propType]?.options || [];
    const option = existing.find((o) => o.id === optionId);
    if (!option) {
      res.status(404).json({ success: false, message: `Option with id "${optionId}" not found` });
      return;
    }
    const updatedOptions = existing.map((o) => o.id === optionId ? { id: o.id, name: newName } : { id: o.id, name: o.name });
    const body = propType === "status"
      ? { properties: { [propertyName]: { status: { options: updatedOptions, groups: prop.status?.groups || [] } } } }
      : { properties: { [propertyName]: { [propType]: { options: updatedOptions } } } };
    await notion.request({ path: `databases/${dbId}`, method: "patch", body });
    clearCachedSchema(req.uid!);
    req.log.info({ propertyName, optionId, newName }, "Option renamed");
    res.json({ success: true, message: `Option renamed to "${newName}"` });
  } catch (error: any) {
    req.log.error({ err: error }, "Rename Option Error");
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to rename option" });
  }
});

router.delete("/notion/property-options", async (req, res) => {
  const { propertyName, optionId } = req.body as { propertyName?: string; optionId?: string };
  if (!propertyName || !optionId) {
    res.status(400).json({ success: false, message: "propertyName and optionId are required" });
    return;
  }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const dbId = normalizeDbId(creds.notion_database_id);
    const db: any = await notion.databases.retrieve({ database_id: dbId });
    const prop = db.properties[propertyName];
    if (!prop || !OPTION_TYPES.has(prop.type)) {
      res.status(400).json({ success: false, message: `Property "${propertyName}" is not a select/multi_select/status` });
      return;
    }
    const propType = prop.type as "select" | "multi_select" | "status";
    const existing: Array<{ id: string; name: string; color?: string }> = prop[propType]?.options || [];
    const remaining = existing.filter((o) => o.id !== optionId).map((o) => ({ id: o.id, name: o.name }));
    const body = propType === "status"
      ? { properties: { [propertyName]: { status: { options: remaining, groups: prop.status?.groups || [] } } } }
      : { properties: { [propertyName]: { [propType]: { options: remaining } } } };
    await notion.request({ path: `databases/${dbId}`, method: "patch", body });
    clearCachedSchema(req.uid!);
    req.log.info({ propertyName, optionId }, "Option deleted");
    res.json({ success: true, message: "Option deleted" });
  } catch (error: any) {
    req.log.error({ err: error }, "Delete Option Error");
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete option" });
  }
});

/* ─── GET /notion/verify-page/:pageId ──────────────────────────────────── */

router.get("/notion/verify-page/:pageId", requireAuth, async (req, res) => {
  const pageId = Array.isArray(req.params.pageId) ? req.params.pageId[0] : req.params.pageId;
  if (!pageId) { res.status(400).json({ success: false, exists: false, message: "pageId required" }); return; }
  try {
    const creds = await getUserNotionCredentials(req.uid!, req.idToken!);
    if (!creds) { res.status(400).json({ success: false, exists: false, message: "Notion not connected." }); return; }
    const notion = makeNotionClient(creds.notion_token);
    const page = await notion.pages.retrieve({ page_id: pageId }) as Record<string, unknown>;
    const exists = !!(page && (page as any).id);
    res.json({ success: true, exists, pageId: (page as any).id ?? pageId });
  } catch (err: any) {
    req.log.error({ err, pageId }, "verify-page error");
    res.status(err.status || 500).json({ success: false, exists: false, message: err.message || "Failed to verify page" });
  }
});

export default router;

