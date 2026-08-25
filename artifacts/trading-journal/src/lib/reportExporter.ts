import jsPDF from "jspdf";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ReportTrade {
  id: string;
  Date: string;
  "Profit/Loss": number;
  Pairs?: string;
  Direction?: string;
  [key: string]: any;
}

export interface DayData {
  pnl: number;
  trades: ReportTrade[];
}

export interface MonthlyExportParams {
  format: "png" | "pdf";
  theme: "light" | "dark";
  month: number;
  year: number;
  monthTrades: ReportTrade[];
  dailyData: Record<string, DayData>;
  selectedAccount: string | null;
}

export interface DailyExportParams {
  format: "png" | "pdf";
  theme: "light" | "dark";
  date: string;
  dayTrades: ReportTrade[];
  selectedAccount: string | null;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  light: {
    bg: "#FFFFFF",
    card: "#F8FAFC",
    cardBorder: "#E2E8F0",
    text: "#1E293B",
    textSub: "#475569",
    muted: "#94A3B8",
    accent: "#7C3AED",
    green: "#10B981",
    greenBg: "#ECFDF5",
    greenText: "#065F46",
    red: "#EF4444",
    redBg: "#FFF1F2",
    redText: "#991B1B",
    neutral: "#E2E8F0",
    neutralBg: "#F1F5F9",
    sep: "#E2E8F0",
    footerBg: "#F8FAFC",
    headerBg: "#FAFAFA",
  },
  dark: {
    bg: "#0B1220",
    card: "#111827",
    cardBorder: "#1E2A3A",
    text: "#F1F5F9",
    textSub: "#CBD5E1",
    muted: "#6B7280",
    accent: "#818CF8",
    green: "#22C55E",
    greenBg: "#052E16",
    greenText: "#4ADE80",
    red: "#F87171",
    redBg: "#3B0000",
    redText: "#FCA5A5",
    neutral: "#374151",
    neutralBg: "#1F2937",
    sep: "#1E2A3A",
    footerBg: "#0D1829",
    headerBg: "#0D1829",
  },
} as const;

type Theme = (typeof T)["light" | "dark"];

// ─── Image cache ──────────────────────────────────────────────────────────────
const imgCache = new Map<string, HTMLImageElement>();

async function loadImg(src: string): Promise<HTMLImageElement | null> {
  if (imgCache.has(src)) return imgCache.get(src)!;
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgCache.set(src, img); res(img); };
    img.onerror = () => res(null);
    img.src = src;
  });
}

// ─── Trade field helpers ──────────────────────────────────────────────────────
function pnl(t: any): number {
  return Number(t["Profit/Loss"] ?? t["PnL"] ?? t["P&L"] ?? 0);
}

function rr(t: any): number | null {
  for (const k of ["RR", "R:R", "Risk Reward", "Risk/Reward", "R Multiple"]) {
    const v = Number(t[k]);
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}

function dir(t: any): string {
  return String(t["Direction"] ?? t["Bias"] ?? t["Side"] ?? "");
}

function pair(t: any): string {
  return String(t["Pairs"] ?? t["Pair"] ?? t["Symbol"] ?? t["Asset"] ?? "");
}

// ─── Drawing primitives ───────────────────────────────────────────────────────
function rRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function accentGrad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  isDark: boolean,
): CanvasGradient {
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  if (isDark) {
    g.addColorStop(0, "#7C3AED");
    g.addColorStop(1, "#3B82F6");
  } else {
    g.addColorStop(0, "#7C3AED");
    g.addColorStop(1, "#6366F1");
  }
  return g;
}

function fmtMoney(v: number, short = false): string {
  const a = Math.abs(v);
  const prefix = v >= 0 ? "+" : "-";
  if (short && a >= 1000) return `${prefix}$${(a / 1000).toFixed(1)}k`;
  return `${prefix}$${a.toFixed(2)}`;
}

// ─── Stats calculations ───────────────────────────────────────────────────────
function monthStats(
  trades: ReportTrade[],
  dailyData: Record<string, DayData>,
  month: number,
  year: number,
) {
  const tot = trades.reduce((s, t) => s + pnl(t), 0);
  const cnt = trades.length;
  const wins = trades.filter((t) => pnl(t) > 0).length;
  const winRate = cnt > 0 ? (wins / cnt) * 100 : 0;
  const dayPnLs = Object.entries(dailyData)
    .filter(([ds]) => {
      const d = new Date(ds + "T12:00:00");
      return d.getMonth() === month && d.getFullYear() === year;
    })
    .map(([, v]) => v.pnl);
  const bestDay = dayPnLs.length ? Math.max(...dayPnLs) : 0;
  const worstDay = dayPnLs.length ? Math.min(...dayPnLs) : 0;
  const gross = trades.reduce((s, t) => { const p = pnl(t); return s + (p > 0 ? p : 0); }, 0);
  const loss  = trades.reduce((s, t) => { const p = pnl(t); return s + (p < 0 ? -p : 0); }, 0);
  const pf = loss > 0 ? gross / loss : gross > 0 ? 99 : 0;
  const LONG  = new Set(["Long","long","BUY","Buy","buy","LONG"]);
  const SHORT = new Set(["Short","short","SELL","Sell","sell","SHORT"]);
  const longPnl  = trades.filter((t) => LONG.has(dir(t))).reduce((s, t) => s + pnl(t), 0);
  const shortPnl = trades.filter((t) => SHORT.has(dir(t))).reduce((s, t) => s + pnl(t), 0);
  const rrVals = trades.map(rr).filter((v): v is number => v !== null);
  const avgRR = rrVals.length ? rrVals.reduce((s, v) => s + v, 0) / rrVals.length : null;
  return { tot, cnt, wins, winRate, bestDay, worstDay, pf, longPnl, shortPnl, avgRR };
}

function dayStats(trades: ReportTrade[]) {
  const tot = trades.reduce((s, t) => s + pnl(t), 0);
  const cnt = trades.length;
  const wins = trades.filter((t) => pnl(t) > 0).length;
  const winRate = cnt > 0 ? (wins / cnt) * 100 : 0;
  const pnls = trades.map(pnl);
  const best  = pnls.length ? Math.max(...pnls) : 0;
  const worst = pnls.length ? Math.min(...pnls) : 0;
  const gross = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const loss  = pnls.filter((p) => p < 0).reduce((s, p) => s - p, 0);
  const pf = loss > 0 ? gross / loss : gross > 0 ? 99 : 0;
  const rrVals = trades.map(rr).filter((v): v is number => v !== null);
  const avgRR = rrVals.length ? rrVals.reduce((s, v) => s + v, 0) / rrVals.length : null;
  return { tot, cnt, wins, winRate, best, worst, pf, avgRR };
}

// ─── Draw header logo + title ─────────────────────────────────────────────────
async function drawHeader(
  ctx: CanvasRenderingContext2D,
  W: number,
  th: Theme,
  isDark: boolean,
  title: string,
  subtitle: string,
  logoUrl: string,
  qrUrl: string,
) {
  const H = 120;
  ctx.fillStyle = th.headerBg;
  ctx.fillRect(0, 0, W, H);

  const logo = await loadImg(logoUrl);
  if (logo) {
    const lh = 64;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    ctx.save();
    rRect(ctx, 24, (H - lh) / 2, lw, lh, 12);
    ctx.clip();
    ctx.drawImage(logo, 24, (H - lh) / 2, lw, lh);
    ctx.restore();
  } else {
    ctx.fillStyle = th.accent;
    ctx.font = "800 26px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Select2Notion", 28, H / 2 + 10);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = th.text;
  ctx.font = "800 32px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.fillText(title, W - 32, H / 2 - 4);
  ctx.fillStyle = th.muted;
  ctx.font = "600 14px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.fillText(subtitle, W - 32, H / 2 + 20);

  ctx.fillStyle = th.sep;
  ctx.fillRect(0, H, W, 1);

  void isDark; void qrUrl;
  return H + 1;
}

// ─── Draw stat card ───────────────────────────────────────────────────────────
function drawStatCard(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string, value: string, color: string,
  th: Theme,
) {
  ctx.fillStyle = th.card;
  rRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = th.cardBorder;
  ctx.lineWidth = 1;
  rRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  ctx.fillStyle = th.muted;
  ctx.font = "700 11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label.toUpperCase(), x + 14, y + 22);

  ctx.fillStyle = color;
  ctx.font = "800 20px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(value, x + 14, y + h - 18);
}

// ─── Draw footer ──────────────────────────────────────────────────────────────
async function drawFooter(
  ctx: CanvasRenderingContext2D,
  W: number, yStart: number, H: number,
  th: Theme, isDark: boolean, qrUrl: string,
) {
  ctx.fillStyle = th.footerBg;
  ctx.fillRect(0, yStart, W, H);
  ctx.fillStyle = th.sep;
  ctx.fillRect(0, yStart, W, 1);

  const qrSize = H - 24;
  const qr = await loadImg(qrUrl);
  if (qr) {
    const qrX = W - 32 - qrSize;
    const qrY = yStart + 12;
    if (!isDark) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8);
    }
    ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = th.accent;
  ctx.font = "800 15px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.fillText("Track • Analyze • Improve", 32, yStart + H / 2 - 6);
  ctx.fillStyle = th.muted;
  ctx.font = "500 12px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.fillText("select2notion.com", 32, yStart + H / 2 + 14);
}

// ─── Monthly Report ───────────────────────────────────────────────────────────
async function drawMonthly(params: MonthlyExportParams): Promise<HTMLCanvasElement> {
  const { month, year, monthTrades, dailyData, selectedAccount, theme } = params;
  const th = T[theme];
  const isDark = theme === "dark";
  const W = 1200;
  const CANVAS_H = 1600;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  const base = import.meta.env.BASE_URL as string;
  const logoUrl = `${base}logo-s2n.jpg`;
  const qrUrl   = `${base}qr-s2n.jpg`;

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, CANVAS_H);

  const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  const acct = selectedAccount ? selectedAccount : "All Accounts";
  let y = await drawHeader(ctx, W, th, isDark,
    MONTH_NAMES[month] + " " + year, acct, logoUrl, qrUrl);

  const s = monthStats(monthTrades, dailyData, month, year);

  // ── Stats band ──────────────────────────────────────────────────────────────
  const PAD = 20;
  const COLS = 3;
  const ROWS = 3;
  const STATS_H = 72;
  const GAP = 10;
  const totalW = W - PAD * 2;
  const cardW = (totalW - GAP * (COLS - 1)) / COLS;
  y += 18;

  const stats9: Array<{ label: string; value: string; color: string }> = [
    {
      label: "Total PnL",
      value: fmtMoney(s.tot),
      color: s.tot >= 0 ? th.green : th.red,
    },
    {
      label: "Win Rate",
      value: s.cnt ? `${s.winRate.toFixed(1)}%` : "—",
      color: s.winRate >= 50 ? th.green : th.red,
    },
    {
      label: "Trades",
      value: String(s.cnt),
      color: th.text,
    },
    {
      label: "Profit Factor",
      value: s.pf >= 99 ? "∞" : s.pf.toFixed(2),
      color: s.pf >= 1 ? th.green : th.red,
    },
    {
      label: "Best Day",
      value: fmtMoney(s.bestDay, true),
      color: th.green,
    },
    {
      label: "Worst Day",
      value: fmtMoney(s.worstDay, true),
      color: th.red,
    },
    {
      label: "Avg RR",
      value: s.avgRR !== null ? `${s.avgRR.toFixed(2)}R` : "—",
      color: th.textSub,
    },
    {
      label: "Long PnL",
      value: fmtMoney(s.longPnl, true),
      color: s.longPnl >= 0 ? th.green : th.red,
    },
    {
      label: "Short PnL",
      value: fmtMoney(s.shortPnl, true),
      color: s.shortPnl >= 0 ? th.green : th.red,
    },
  ];

  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const idx = i * COLS + j;
      const st = stats9[idx];
      const cx = PAD + j * (cardW + GAP);
      const cy = y + i * (STATS_H + GAP);
      drawStatCard(ctx, cx, cy, cardW, STATS_H, st.label, st.value, st.color, th);
    }
  }
  y += ROWS * (STATS_H + GAP) + 10;

  // ── Calendar section ─────────────────────────────────────────────────────────
  const FOOTER_H = 120;
  const CAL_Y_END = CANVAS_H - FOOTER_H;
  const CAL_TOP = y;

  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const DAYS_HEADER_H = 36;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeksNeeded = Math.ceil((firstDay + daysInMonth) / 7);
  const CELL_W = Math.floor((W - PAD * 2) / 7);
  const CELL_H = Math.floor((CAL_Y_END - CAL_TOP - DAYS_HEADER_H) / weeksNeeded);

  // Section label
  ctx.fillStyle = th.muted;
  ctx.font = "700 11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PERFORMANCE CALENDAR", PAD, CAL_TOP + 14);

  const calGridY = CAL_TOP + 22;

  // Day headers
  for (let d = 0; d < 7; d++) {
    const dx = PAD + d * CELL_W + CELL_W / 2;
    ctx.fillStyle = th.muted;
    ctx.font = "700 12px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(DAYS[d], dx, calGridY + DAYS_HEADER_H - 10);
  }

  // Separator under headers
  ctx.fillStyle = th.sep;
  ctx.fillRect(PAD, calGridY + DAYS_HEADER_H - 4, CELL_W * 7, 1);

  // Week cells
  const cellStartY = calGridY + DAYS_HEADER_H;

  for (let week = 0; week < weeksNeeded; week++) {
    for (let wd = 0; wd < 7; wd++) {
      const dayNum = week * 7 + wd - firstDay + 1;
      if (dayNum < 1 || dayNum > daysInMonth) continue;

      const cx = PAD + wd * CELL_W;
      const cy = cellStartY + week * CELL_H;
      const cw = CELL_W - 3;
      const ch = CELL_H - 3;

      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const dayEntry = dailyData[dateStr];

      let bgColor: string = th.neutralBg;
      let pnlColor: string = th.muted;
      if (dayEntry) {
        if (dayEntry.pnl > 0) { bgColor = th.greenBg; pnlColor = th.green; }
        else if (dayEntry.pnl < 0) { bgColor = th.redBg; pnlColor = th.red; }
        else { bgColor = th.neutralBg; pnlColor = th.muted; }
      }

      ctx.fillStyle = bgColor;
      rRect(ctx, cx + 1, cy + 1, cw, ch, 8);
      ctx.fill();
      if (dayEntry) {
        ctx.strokeStyle = dayEntry.pnl > 0 ? th.green : dayEntry.pnl < 0 ? th.red : th.neutral;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.4;
        rRect(ctx, cx + 1, cy + 1, cw, ch, 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Day number
      ctx.fillStyle = dayEntry ? th.text : th.muted;
      ctx.font = `${dayEntry ? "700" : "500"} ${CELL_H > 120 ? 15 : 12}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(String(dayNum), cx + 8, cy + (CELL_H > 120 ? 22 : 16));

      if (dayEntry) {
        // PnL
        const pnlFontSize = CELL_H > 140 ? 18 : CELL_H > 100 ? 15 : 12;
        ctx.fillStyle = pnlColor;
        ctx.font = `800 ${pnlFontSize}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(fmtMoney(dayEntry.pnl, true), cx + cw / 2, cy + ch / 2 + 6);

        // Trade count
        ctx.fillStyle = th.muted;
        ctx.font = `600 ${CELL_H > 100 ? 11 : 10}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
        ctx.fillText(`${dayEntry.trades.length}T`, cx + cw / 2, cy + ch - 8);
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  await drawFooter(ctx, W, CAL_Y_END, FOOTER_H, th, isDark, qrUrl);

  // ── Branding gradient bar at top ───────────────────────────────────────────
  ctx.save();
  const grad = accentGrad(ctx, 0, 0, W, 0, isDark);
  ctx.fillStyle = grad;
  ctx.globalAlpha = isDark ? 0.7 : 0.5;
  ctx.fillRect(0, 0, W, 4);
  ctx.globalAlpha = 1;
  ctx.restore();

  if (!monthTrades.length) {
    ctx.fillStyle = th.muted;
    ctx.font = "600 18px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No trades recorded for this period.", W / 2, CANVAS_H / 2);
  }

  return canvas;
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
async function drawDaily(params: DailyExportParams): Promise<HTMLCanvasElement> {
  const { date, dayTrades, selectedAccount, theme } = params;
  const th = T[theme];
  const isDark = theme === "dark";
  const W = 1200;
  const CANVAS_H = 1200;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  const base = import.meta.env.BASE_URL as string;
  const logoUrl = `${base}logo-s2n.jpg`;
  const qrUrl   = `${base}qr-s2n.jpg`;

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, CANVAS_H);

  const dateObj = new Date(date + "T12:00:00");
  const dayLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const acct = selectedAccount ?? "All Accounts";

  let y = await drawHeader(ctx, W, th, isDark, dayLabel, acct, logoUrl, qrUrl);

  const s = dayStats(dayTrades);

  // ── Big PnL ──────────────────────────────────────────────────────────────────
  const BIG_H = 180;
  const pnlColor = s.tot >= 0 ? th.green : th.red;
  ctx.fillStyle = s.tot >= 0 ? th.greenBg : th.redBg;
  ctx.fillRect(0, y, W, BIG_H);

  ctx.fillStyle = pnlColor;
  ctx.font = "900 80px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(fmtMoney(s.tot), W / 2, y + BIG_H / 2 + 28);

  ctx.fillStyle = th.muted;
  ctx.font = "600 16px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.fillText("Daily P&L", W / 2, y + 28);

  ctx.fillStyle = th.sep;
  ctx.fillRect(0, y + BIG_H, W, 1);
  y += BIG_H + 1;

  // ── Metrics grid ─────────────────────────────────────────────────────────────
  const PAD = 20;
  const GAP = 10;
  const MET_COLS = 3;
  const MET_H = 80;
  const MET_ROWS = 2;
  const metW = (W - PAD * 2 - GAP * (MET_COLS - 1)) / MET_COLS;

  y += 18;

  const metrics6 = [
    { label: "Trades",        value: String(s.cnt),                          color: th.text },
    { label: "Win Rate",      value: s.cnt ? `${s.winRate.toFixed(1)}%` : "—", color: s.winRate >= 50 ? th.green : th.red },
    { label: "Avg RR",        value: s.avgRR !== null ? `${s.avgRR.toFixed(2)}R` : "—", color: th.textSub },
    { label: "Best Trade",    value: fmtMoney(s.best, true),                 color: th.green },
    { label: "Worst Trade",   value: fmtMoney(s.worst, true),                color: th.red },
    { label: "Profit Factor", value: s.pf >= 99 ? "∞" : s.pf.toFixed(2),   color: s.pf >= 1 ? th.green : th.red },
  ];

  for (let i = 0; i < MET_ROWS; i++) {
    for (let j = 0; j < MET_COLS; j++) {
      const m = metrics6[i * MET_COLS + j];
      const mx = PAD + j * (metW + GAP);
      const my = y + i * (MET_H + GAP);
      drawStatCard(ctx, mx, my, metW, MET_H, m.label, m.value, m.color, th);
    }
  }
  y += MET_ROWS * (MET_H + GAP) + 14;

  // ── Trade list ────────────────────────────────────────────────────────────────
  const FOOTER_H = 110;
  const TRADE_AREA_H = CANVAS_H - y - FOOTER_H;
  const sorted = [...dayTrades].sort((a, b) => Math.abs(pnl(b)) - Math.abs(pnl(a)));
  const maxTrades = 8;
  const shown = sorted.slice(0, maxTrades);
  const ROW_H = Math.min(Math.floor(TRADE_AREA_H / (shown.length || 1)), 68);

  ctx.fillStyle = th.muted;
  ctx.font = "700 11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TODAY'S TRADES", PAD, y + 14);
  y += 24;

  if (shown.length === 0) {
    ctx.fillStyle = th.muted;
    ctx.font = "600 18px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No trades recorded.", W / 2, y + 40);
  } else {
    for (let i = 0; i < shown.length; i++) {
      const t = shown[i];
      const tp = pnl(t);
      const ty = y + i * (ROW_H + 4);
      const tColor = tp >= 0 ? th.green : th.red;
      const tBg    = tp >= 0 ? th.greenBg : th.redBg;

      ctx.fillStyle = th.card;
      rRect(ctx, PAD, ty, W - PAD * 2, ROW_H, 10);
      ctx.fill();

      // Accent left border
      ctx.fillStyle = tColor;
      ctx.globalAlpha = 0.8;
      rRect(ctx, PAD, ty, 4, ROW_H, 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Pair
      ctx.fillStyle = th.text;
      ctx.font = "800 15px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(pair(t) || "—", PAD + 18, ty + ROW_H / 2 + 5);

      // Direction badge
      const d = dir(t);
      if (d) {
        const isLong = /long|buy/i.test(d);
        const bColor = isLong ? th.green : th.red;
        const bBg    = isLong ? th.greenBg : th.redBg;
        const bW = 56;
        const bH = 22;
        const bX = PAD + 220;
        const bY = ty + (ROW_H - bH) / 2;
        ctx.fillStyle = bBg;
        rRect(ctx, bX, bY, bW, bH, 6);
        ctx.fill();
        ctx.fillStyle = bColor;
        ctx.font = "700 11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(d.toUpperCase(), bX + bW / 2, bY + bH / 2 + 4);
      }

      // RR
      const rrVal = rr(t);
      if (rrVal !== null) {
        ctx.fillStyle = th.muted;
        ctx.font = "600 13px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${rrVal.toFixed(2)}R`, W / 2, ty + ROW_H / 2 + 5);
      }

      // PnL
      ctx.fillStyle = tColor;
      ctx.font = "800 18px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(fmtMoney(tp), W - PAD - 16, ty + ROW_H / 2 + 6);

      void tBg;
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  await drawFooter(ctx, W, CANVAS_H - FOOTER_H, FOOTER_H, th, isDark, qrUrl);

  // ── Top gradient bar ──────────────────────────────────────────────────────────
  ctx.save();
  const grad = accentGrad(ctx, 0, 0, W, 0, isDark);
  ctx.fillStyle = grad;
  ctx.globalAlpha = isDark ? 0.7 : 0.5;
  ctx.fillRect(0, 0, W, 4);
  ctx.globalAlpha = 1;
  ctx.restore();

  return canvas;
}

// ─── Download helpers ─────────────────────────────────────────────────────────
function downloadPNG(canvas: HTMLCanvasElement, filename: string) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function downloadPDF(canvas: HTMLCanvasElement, filename: string) {
  const W = canvas.width;
  const H = canvas.height;
  const isLandscape = W > H;
  const pdf = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "px",
    format: [W, H],
    hotfixes: ["px_scaling"],
  });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  pdf.addImage(imgData, "JPEG", 0, 0, W, H);
  pdf.save(filename);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function exportMonthlyReport(params: MonthlyExportParams): Promise<void> {
  const canvas = await drawMonthly(params);
  const MONTH_NAMES = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  const base = `Select2Notion_Monthly_${MONTH_NAMES[params.month]}${params.year}`;
  if (params.format === "pdf") {
    downloadPDF(canvas, `${base}.pdf`);
  } else {
    downloadPNG(canvas, `${base}.png`);
  }
}

export async function exportDailyReport(params: DailyExportParams): Promise<void> {
  const canvas = await drawDaily(params);
  const clean = params.date.replace(/-/g, "");
  const base = `Select2Notion_Daily_${clean}`;
  if (params.format === "pdf") {
    downloadPDF(canvas, `${base}.pdf`);
  } else {
    downloadPNG(canvas, `${base}.png`);
  }
}
