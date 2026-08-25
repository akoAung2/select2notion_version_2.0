/**
 * Analysis Engine — server-side statistics calculation.
 * AI must NEVER guess P&L. We calculate all numbers here and feed them to the AI.
 */

/* ─────────────────────────────────────────────────────────────
   PROPERTY ALIAS SYSTEM
   Maps common trading journal property names to logical groups.
   Emotion → Mindset → Psychology etc. are treated as equivalent.
───────────────────────────────────────────────────────────── */

export const PROP_ALIASES = {
  PNL: [
    "Profit/Loss", "P&L", "PNL", "Net P&L", "Net Profit", "Profit", "Result",
    "Outcome", "Gain/Loss", "Return", "Net Return", "Trade Result",
  ],
  SESSION: [
    "Session", "Trading Session", "Market Session", "Time", "Market",
    "Session Type", "Trade Session",
  ],
  SETUP: [
    "Setup", "Trade Setup", "Strategy", "Pattern", "Entry Type", "Trade Type",
    "System", "Setup Type", "Trade Pattern", "Signal",
  ],
  EMOTION: [
    "Emotion", "Mindset", "Psychology", "Mental State", "Feelings", "Mood",
    "State", "Mental", "Emotional State", "Feeling",
  ],
  PAIR: [
    "Pairs", "Pair", "Symbol", "Instrument", "Asset", "Currency Pair",
    "Ticker", "Market", "Product", "Contract",
  ],
  RR: [
    "RR", "Risk Reward", "R:R", "Risk/Reward", "Ratio", "R Multiple",
    "Risk Ratio", "Reward/Risk", "R/R",
  ],
  DIRECTION: [
    "Direction", "Bias", "Long/Short", "Side", "Trade Direction",
    "Trade Side", "Type", "Buy/Sell",
  ],
  DATE: ["Date", "Trade Date", "Entry Date", "Date/Time"],
  NAME: ["Name", "Title", "Trade Name", "Trade ID"],
} as const;

/* ─────────────────────────────────────────────────────────────
   PROPERTY RESOLUTION
───────────────────────────────────────────────────────────── */

/**
 * Find a property in the schema using a list of aliases.
 * Returns the exact schema key that matches, or null.
 */
export function findSchemaProperty(schema: Record<string, unknown>, aliases: readonly string[]): string | null {
  // Exact match first
  for (const alias of aliases) {
    if (alias in schema) return alias;
  }
  // Case-insensitive match
  const schemaKeys = Object.keys(schema);
  for (const alias of aliases) {
    const lower = alias.toLowerCase();
    const found = schemaKeys.find((k) => k.toLowerCase() === lower);
    if (found) return found;
  }
  return null;
}

/**
 * Resolve an AI-extracted property name to the actual schema key.
 * Uses alias groups + fuzzy matching.
 */
export function resolvePropertyName(name: string, schema: Record<string, unknown>): string | null {
  if (name in schema) return name;
  // Find which alias group this name belongs to
  for (const aliases of Object.values(PROP_ALIASES)) {
    if ((aliases as readonly string[]).some((a) => a.toLowerCase() === name.toLowerCase())) {
      const found = findSchemaProperty(schema, aliases as readonly string[]);
      if (found) return found;
    }
  }
  // Partial match
  const lower = name.toLowerCase();
  const keys = Object.keys(schema);
  return keys.find((k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) ?? null;
}

/* ─────────────────────────────────────────────────────────────
   STATISTICS TYPES
───────────────────────────────────────────────────────────── */

export interface GroupEntry {
  count: number;
  wins: number;
  losses: number;
  totalPnL: number;
  winRate: number;
}
export type GroupStats = Record<string, GroupEntry>;

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  maxWin: number;
  maxLoss: number;
  avgRR: number | null;
  // Detected field names (null = not found)
  pnlField: string | null;
  sessionField: string | null;
  setupField: string | null;
  emotionField: string | null;
  rrField: string | null;
  pairField: string | null;
  // Breakdowns
  bySession: GroupStats;
  bySetup: GroupStats;
  byEmotion: GroupStats;
  byPair: GroupStats;
}

/* ─────────────────────────────────────────────────────────────
   CORE STATISTICS CALCULATOR
───────────────────────────────────────────────────────────── */

type TradeRow = Record<string, string | number | null | undefined>;

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^-0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function addToGroup(groups: GroupStats, rawKey: string | null, pnl: number | null, isWin: boolean | null): void {
  if (!rawKey || rawKey.trim() === "") return;
  const keys = rawKey.includes(",") ? rawKey.split(",").map((s) => s.trim()).filter(Boolean) : [rawKey.trim()];
  for (const key of keys) {
    if (!key) continue;
    if (!groups[key]) groups[key] = { count: 0, wins: 0, losses: 0, totalPnL: 0, winRate: 0 };
    groups[key].count++;
    if (isWin === true) groups[key].wins++;
    if (isWin === false) groups[key].losses++;
    if (pnl !== null) groups[key].totalPnL += pnl;
  }
}

export function calculateStats(trades: TradeRow[], schema: Record<string, unknown>): TradeStats {
  const pnlField = findSchemaProperty(schema, PROP_ALIASES.PNL);
  const sessionField = findSchemaProperty(schema, PROP_ALIASES.SESSION);
  const setupField = findSchemaProperty(schema, PROP_ALIASES.SETUP);
  const emotionField = findSchemaProperty(schema, PROP_ALIASES.EMOTION);
  const rrField = findSchemaProperty(schema, PROP_ALIASES.RR);
  const pairField = findSchemaProperty(schema, PROP_ALIASES.PAIR);

  let wins = 0, losses = 0, breakeven = 0;
  let totalPnL = 0;
  let maxWin = -Infinity, maxLoss = Infinity;
  let rrTotal = 0, rrCount = 0;

  const bySession: GroupStats = {};
  const bySetup: GroupStats = {};
  const byEmotion: GroupStats = {};
  const byPair: GroupStats = {};

  for (const trade of trades) {
    const pnl = pnlField ? parseNum(trade[pnlField]) : null;
    const rr = rrField ? parseNum(trade[rrField]) : null;

    let isWin: boolean | null = null;
    if (pnl !== null) {
      if (pnl > 0) { wins++; isWin = true; }
      else if (pnl < 0) { losses++; isWin = false; }
      else breakeven++;
      totalPnL += pnl;
      if (pnl > maxWin) maxWin = pnl;
      if (pnl < maxLoss) maxLoss = pnl;
    }

    if (rr !== null && rr > 0) { rrTotal += rr; rrCount++; }

    addToGroup(bySession, sessionField ? String(trade[sessionField] ?? "") : null, pnl, isWin);
    addToGroup(bySetup, setupField ? String(trade[setupField] ?? "") : null, pnl, isWin);
    addToGroup(byEmotion, emotionField ? String(trade[emotionField] ?? "") : null, pnl, isWin);
    addToGroup(byPair, pairField ? String(trade[pairField] ?? "") : null, pnl, isWin);
  }

  // Finalize group win rates + round P&L
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const groups of [bySession, bySetup, byEmotion, byPair]) {
    for (const v of Object.values(groups)) {
      const decided = v.wins + v.losses;
      v.winRate = decided > 0 ? Math.round((v.wins / decided) * 1000) / 10 : 0;
      v.totalPnL = round2(v.totalPnL);
    }
  }

  const totalDecided = wins + losses;
  return {
    totalTrades: trades.length,
    wins, losses, breakeven,
    winRate: totalDecided > 0 ? Math.round((wins / totalDecided) * 1000) / 10 : 0,
    totalPnL: round2(totalPnL),
    avgPnL: trades.length > 0 ? round2(totalPnL / trades.length) : 0,
    maxWin: maxWin === -Infinity ? 0 : round2(maxWin),
    maxLoss: maxLoss === Infinity ? 0 : round2(maxLoss),
    avgRR: rrCount > 0 ? round2(rrTotal / rrCount) : null,
    pnlField, sessionField, setupField, emotionField, rrField, pairField,
    bySession, bySetup, byEmotion, byPair,
  };
}

/* ─────────────────────────────────────────────────────────────
   STATS FORMATTER — feeds pre-calculated numbers to AI
───────────────────────────────────────────────────────────── */

function topN(groups: GroupStats, n: number, sortBy: "winRate" | "totalPnL" = "totalPnL", minCount = 2): string {
  return Object.entries(groups)
    .filter(([, v]) => v.count >= minCount)
    .sort(([, a], [, b]) => b[sortBy] - a[sortBy])
    .slice(0, n)
    .map(([k, v]) => `${k} (${v.count}T, ${v.winRate}%WR, P&L ${v.totalPnL >= 0 ? "+" : ""}${v.totalPnL})`)
    .join(" | ");
}

function worstN(groups: GroupStats, n: number, minCount = 2): string {
  return Object.entries(groups)
    .filter(([, v]) => v.count >= minCount)
    .sort(([, a], [, b]) => a.totalPnL - b.totalPnL)
    .slice(0, n)
    .map(([k, v]) => `${k} (${v.count}T, ${v.winRate}%WR, P&L ${v.totalPnL >= 0 ? "+" : ""}${v.totalPnL})`)
    .join(" | ");
}

export function formatStatsForPrompt(stats: TradeStats, label = "TRADING STATISTICS"): string {
  const pnlSign = stats.totalPnL >= 0 ? "+" : "";
  const lines = [
    `=== ${label} (PRE-CALCULATED — DO NOT RECALCULATE) ===`,
    `Trades: ${stats.totalTrades} total (${stats.wins}W / ${stats.losses}L / ${stats.breakeven}BE)`,
    `Win Rate: ${stats.winRate}%`,
    `Total P&L: ${pnlSign}${stats.totalPnL}`,
    `Avg P&L/Trade: ${stats.avgPnL >= 0 ? "+" : ""}${stats.avgPnL}`,
    `Best Trade: +${stats.maxWin}`,
    `Worst Trade: ${stats.maxLoss}`,
  ];
  if (stats.avgRR !== null) lines.push(`Avg RR: ${stats.avgRR}`);

  const addGroup = (label: string, groups: GroupStats, sortBy: "winRate" | "totalPnL" = "totalPnL") => {
    const best = topN(groups, 3, sortBy, 1);
    const worst = worstN(groups, 2, 1);
    if (best) lines.push(`Best ${label}: ${best}`);
    if (worst && worst !== best) lines.push(`Worst ${label}: ${worst}`);
  };

  if (Object.keys(stats.bySession).length > 0) addGroup("Sessions", stats.bySession, "totalPnL");
  if (Object.keys(stats.bySetup).length > 0) addGroup("Setups", stats.bySetup, "totalPnL");
  if (Object.keys(stats.byEmotion).length > 0) addGroup("Emotions", stats.byEmotion, "winRate");
  if (Object.keys(stats.byPair).length > 0) addGroup("Pairs", stats.byPair, "totalPnL");

  lines.push(`=== END STATISTICS ===`);
  return lines.join("\n");
}
