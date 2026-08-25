import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ShieldAlert,
  Settings2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Info,
} from "lucide-react";

// ─── Funded Company Rule Presets ────────────────────────────────────────────
// dailyDrawdown & maxDrawdown are in dollars (absolute loss limits).
// Trailing = max drawdown trails highest balance (affects some companies).
// To add a new company: add a new key to FUNDED_RULES with its account sizes.
// To add a new account size: add a new key inside the company object.
interface AccountRule {
  dailyDrawdown: number;  // absolute $ daily loss limit
  maxDrawdown: number;    // absolute $ maximum drawdown limit
  dailyPct: number;       // percentage of account size (for display)
  maxPct: number;         // percentage of account size (for display)
  trailing: boolean;      // true = max DD trails peak balance
}

type CompanyRules = Record<string, AccountRule>;

// FundedNext Two-Step Model — 5% daily / 10% max (static, balance-based)
// Funding Pips Two-Step Model (Evaluation & Master) — same 5% / 10% structure
// Add or edit entries here when company rules change.
const FUNDED_RULES: Record<string, CompanyRules> = {
  FundedNext: {
    // Two-Step Model — static drawdown from starting balance
    "$6,000":   { dailyDrawdown: 300,   maxDrawdown: 600,   dailyPct: 5, maxPct: 10, trailing: false },
    "$15,000":  { dailyDrawdown: 750,   maxDrawdown: 1500,  dailyPct: 5, maxPct: 10, trailing: false },
    "$25,000":  { dailyDrawdown: 1250,  maxDrawdown: 2500,  dailyPct: 5, maxPct: 10, trailing: false },
    "$50,000":  { dailyDrawdown: 2500,  maxDrawdown: 5000,  dailyPct: 5, maxPct: 10, trailing: false },
    "$100,000": { dailyDrawdown: 5000,  maxDrawdown: 10000, dailyPct: 5, maxPct: 10, trailing: false },
    "$200,000": { dailyDrawdown: 10000, maxDrawdown: 20000, dailyPct: 5, maxPct: 10, trailing: false },
  },
  "Funding Pips": {
    // Fannet Pick — Phase 2 Challenge model — 5% daily / 10% max
    "$5,000":   { dailyDrawdown: 250,  maxDrawdown: 500,   dailyPct: 5, maxPct: 10, trailing: false },
    "$10,000":  { dailyDrawdown: 500,  maxDrawdown: 1000,  dailyPct: 5, maxPct: 10, trailing: false },
    "$25,000":  { dailyDrawdown: 1250, maxDrawdown: 2500,  dailyPct: 5, maxPct: 10, trailing: false },
    "$50,000":  { dailyDrawdown: 2500, maxDrawdown: 5000,  dailyPct: 5, maxPct: 10, trailing: false },
    "$100,000": { dailyDrawdown: 5000, maxDrawdown: 10000, dailyPct: 5, maxPct: 10, trailing: false },
  },
  Custom: {
    // Manually enter any limits via the Override toggle
    "Manual":   { dailyDrawdown: 500,   maxDrawdown: 1000,  dailyPct: 5, maxPct: 10, trailing: false },
  },
};

const LS_KEY = "tradeEdge_drawdownSettings";

interface Settings {
  company: string;
  accountSize: string;
  dailyLimit: number;
  weeklyLimit: number;
  maxLimit: number;
  overrideEnabled: boolean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old account sizes that no longer exist in the rules table
      const validSizes = Object.keys(FUNDED_RULES[parsed.company] || {});
      if (!validSizes.includes(parsed.accountSize)) {
        parsed.accountSize = validSizes[0] || "$6,000";
      }
      return parsed;
    }
  } catch (err) {
    console.warn("[DrawdownTracker] Failed to parse saved settings, using defaults:", err);
  }
  return {
    company: "FundedNext",
    accountSize: "$6,000",
    dailyLimit: 300,
    weeklyLimit: 900,
    maxLimit: 600,
    overrideEnabled: false,
  };
}

function saveSettings(s: Settings) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function currency(v: number) {
  const abs = Math.abs(v);
  const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(abs);
  return (v < 0 ? "-" : v > 0 ? "+" : "") + f;
}

function startOfWeek(d: Date) {
  const c = new Date(d);
  c.setDate(c.getDate() - c.getDay());
  c.setHours(0, 0, 0, 0);
  return c;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ─── Progress Bar ────────────────────────────────────────────────────────────
function DrawdownBar({
  label,
  used,
  limit,
  period,
  tooltip,
}: {
  label: string;
  used: number;           // absolute loss (negative P&L summed, positive = drawdown)
  limit: number;
  period: string;
  tooltip: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const safe = pct < 50;
  const warn = pct >= 50 && pct < 80;
  const danger = pct >= 80;

  const barColor = safe
    ? "var(--app-success)"
    : warn
    ? "var(--app-warning, #f59e0b)"
    : "var(--app-danger)";

  const bgColor = safe
    ? "color-mix(in srgb, var(--app-success) 8%, transparent)"
    : warn
    ? "color-mix(in srgb, #f59e0b 8%, transparent)"
    : "color-mix(in srgb, var(--app-danger) 8%, transparent)";

  return (
    <div
      className="p-5 rounded-2xl space-y-3"
      style={{ background: bgColor, border: `1px solid ${barColor}30` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--app-text)" }}>
            {label}
          </span>
          <div className="relative">
            <Info
              size={13}
              className="cursor-help"
              style={{ color: "var(--app-muted-color)" }}
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
            />
            {showTip && (
              <div
                className="absolute left-5 -top-1 z-20 w-56 px-3 py-2 rounded-xl text-[11px] font-medium shadow-xl pointer-events-none"
                style={{
                  background: "var(--app-card)",
                  border: "1px solid var(--app-border)",
                  color: "var(--app-text)",
                }}
              >
                {tooltip}
              </div>
            )}
          </div>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
          style={{
            background: danger ? "color-mix(in srgb, var(--app-danger) 12%, transparent)" : "color-mix(in srgb, var(--app-bg) 50%, transparent)",
            color: danger ? "var(--app-danger)" : "var(--app-muted-color)",
          }}
        >
          {period}
        </span>
      </div>

      {/* Numbers */}
      <div className="flex items-end justify-between">
        <div>
          <span className="text-2xl font-black tracking-tight" style={{ color: barColor }}>
            {pct.toFixed(1)}%
          </span>
          <span className="ml-2 text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
            used
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs font-black" style={{ color: barColor }}>
            ${used.toFixed(2)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>
            of ${limit.toFixed(2)} limit
          </p>
        </div>
      </div>

      {/* Bar */}
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--app-border) 60%, transparent)" }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{ background: barColor }}
        />
      </div>

      {/* Remaining */}
      <p className="text-[11px] font-medium" style={{ color: "var(--app-muted-color)" }}>
        {limit - used > 0
          ? `$${(limit - used).toFixed(2)} remaining before breach`
          : "⚠️ Limit exceeded — stop trading for this period"}
      </p>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DrawdownTracker({ trades }: { trades: any[] }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persist on every change
  useEffect(() => { saveSettings(settings); }, [settings]);

  // When company or account size changes, auto-load preset rules (unless override is on)
  useEffect(() => {
    if (settings.overrideEnabled) return;
    const rule = FUNDED_RULES[settings.company]?.[settings.accountSize];
    if (rule) {
      setSettings((s) => ({
        ...s,
        dailyLimit: rule.dailyDrawdown,
        weeklyLimit: rule.dailyDrawdown * 3,  // reasonable weekly = 3× daily
        maxLimit: rule.maxDrawdown,
      }));
    }
  }, [settings.company, settings.accountSize, settings.overrideEnabled]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);

  // ─── PNL Computations ────────────────────────────────────────────────────
  const pnlStats = useMemo(() => {
    let dailyPnl = 0, weeklyPnl = 0, monthlyPnl = 0, totalPnl = 0;
    const sessionMap: Record<string, { pnl: number; count: number }> = {};

    trades.forEach((t) => {
      const raw = String(t.Date || "").slice(0, 10);
      if (!raw) return;
      const d = new Date(raw + "T12:00:00");
      const pnl = Number(t["Profit/Loss"]) || 0;
      totalPnl += pnl;
      if (raw === todayStr) dailyPnl += pnl;
      if (d >= weekStart)  weeklyPnl += pnl;
      if (d >= monthStart) monthlyPnl += pnl;

      const session = t["Session"] || "Other";
      if (!sessionMap[session]) sessionMap[session] = { pnl: 0, count: 0 };
      sessionMap[session].pnl += pnl;
      sessionMap[session].count++;
    });

    const sessionPerf = Object.entries(sessionMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);

    return { dailyPnl, weeklyPnl, monthlyPnl, totalPnl, sessionPerf };
  }, [trades, todayStr, weekStart, monthStart]);

  // Drawdown = absolute loss (0 if in profit — only loss triggers drawdown)
  const dailyDrawdown   = Math.max(0, -pnlStats.dailyPnl);
  const weeklyDrawdown  = Math.max(0, -pnlStats.weeklyPnl);
  const monthlyDrawdown = Math.max(0, -pnlStats.monthlyPnl);

  const companies = Object.keys(FUNDED_RULES);
  const accountSizes = Object.keys(FUNDED_RULES[settings.company] || {});
  const preset = FUNDED_RULES[settings.company]?.[settings.accountSize];

  const pnlCards = [
    {
      label: "Today's P&L",
      value: pnlStats.dailyPnl,
      icon: Activity,
      period: "Daily",
    },
    {
      label: "This Week",
      value: pnlStats.weeklyPnl,
      icon: TrendingUp,
      period: "Weekly",
    },
    {
      label: "This Month",
      value: pnlStats.monthlyPnl,
      icon: DollarSign,
      period: "Monthly",
    },
    {
      label: "Total P&L",
      value: pnlStats.totalPnl,
      icon: TrendingUp,
      period: "All Time",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--app-danger) 10%, transparent)", color: "var(--app-danger)" }}
          >
            <ShieldAlert size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight" style={{ color: "var(--app-text)" }}>
              Drawdown Tracker
            </h3>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
              {settings.company} · {settings.accountSize}
              {preset?.trailing ? " · Trailing DD" : " · Static DD"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
          style={{
            background: settingsOpen ? "var(--app-primary)" : "var(--app-card)",
            border: "1px solid var(--app-border)",
            color: settingsOpen ? "var(--app-primary-fg)" : "var(--app-muted-color)",
          }}
        >
          <Settings2 size={14} />
          Configure
          {settingsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="p-6 rounded-2xl space-y-5"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        >
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
            Account Settings
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Company Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Funded Company
              </label>
              <select
                value={settings.company}
                onChange={(e) => {
                  const company = e.target.value;
                  const firstSize = Object.keys(FUNDED_RULES[company] || {})[0] || "";
                  updateSetting("company", company);
                  updateSetting("accountSize", firstSize);
                  updateSetting("overrideEnabled", false);
                }}
                className="w-full px-3 py-2.5 rounded-xl text-sm font-bold outline-none"
                style={{
                  background: "var(--app-bg)",
                  border: "1px solid var(--app-border)",
                  color: "var(--app-text)",
                }}
              >
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Account Size Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Account Size
              </label>
              <select
                value={settings.accountSize}
                onChange={(e) => {
                  updateSetting("accountSize", e.target.value);
                  updateSetting("overrideEnabled", false);
                }}
                className="w-full px-3 py-2.5 rounded-xl text-sm font-bold outline-none"
                style={{
                  background: "var(--app-bg)",
                  border: "1px solid var(--app-border)",
                  color: "var(--app-text)",
                }}
              >
                {accountSizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Preset preview */}
          {preset && !settings.overrideEnabled && (
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 rounded-xl text-xs font-medium"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)",
                color: "var(--app-primary)",
              }}
            >
              <ShieldAlert size={14} className="shrink-0" />
              <span>
                Daily DD: <strong>${preset.dailyDrawdown.toLocaleString()}</strong>
                <span className="opacity-70 ml-1">({preset.dailyPct}% of account)</span>
              </span>
              <span>·</span>
              <span>
                Max DD: <strong>${preset.maxDrawdown.toLocaleString()}</strong>
                <span className="opacity-70 ml-1">({preset.maxPct}% of account)</span>
              </span>
              {preset.trailing && (
                <>
                  <span>·</span>
                  <span className="font-black uppercase tracking-widest text-[10px]">Trailing DD</span>
                </>
              )}
            </div>
          )}

          {/* Override toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => updateSetting("overrideEnabled", !settings.overrideEnabled)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              style={{
                background: settings.overrideEnabled ? "color-mix(in srgb, var(--app-warning, #f59e0b) 10%, transparent)" : "var(--app-bg)",
                border: `1px solid ${settings.overrideEnabled ? "var(--app-warning, #f59e0b)" : "var(--app-border)"}`,
                color: settings.overrideEnabled ? "var(--app-warning, #f59e0b)" : "var(--app-muted-color)",
              }}
            >
              {settings.overrideEnabled ? "Override On" : "Override Limits"}
            </button>
            <span className="text-[11px]" style={{ color: "var(--app-muted-color)" }}>
              Manually set your own drawdown limits
            </span>
          </div>

          {settings.overrideEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { key: "dailyLimit" as const, label: "Daily DD Limit ($)" },
                { key: "weeklyLimit" as const, label: "Weekly DD Limit ($)" },
                { key: "maxLimit" as const, label: "Max DD Limit ($)" },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    value={settings[key]}
                    onChange={(e) => updateSetting(key, Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-bold outline-none"
                    style={{
                      background: "var(--app-bg)",
                      border: "1px solid var(--app-border)",
                      color: "var(--app-text)",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* PNL Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {pnlCards.map(({ label, value, icon: Icon, period }) => {
          const isPositive = value >= 0;
          return (
            <div
              key={label}
              className="p-5 rounded-2xl space-y-2"
              style={{
                background: "var(--app-card)",
                border: "1px solid var(--app-border)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  {period}
                </span>
                <Icon
                  size={14}
                  style={{ color: isPositive ? "var(--app-success)" : "var(--app-danger)" }}
                />
              </div>
              <p className="text-xl font-black tracking-tight leading-none"
                style={{ color: isPositive ? "var(--app-success)" : "var(--app-danger)" }}
              >
                {currency(value)}
              </p>
              <p className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>
                {label}
              </p>
            </div>
          );
        })}
      </div>

      {/* Drawdown Bars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DrawdownBar
          label="Daily Drawdown"
          used={dailyDrawdown}
          limit={settings.dailyLimit}
          period="Today"
          tooltip={`Daily loss limit set by ${settings.company}. Once you lose $${settings.dailyLimit} today, you must stop trading.`}
        />
        <DrawdownBar
          label="Weekly Drawdown"
          used={weeklyDrawdown}
          limit={settings.weeklyLimit}
          period="This Week"
          tooltip={`Cumulative loss this week (Mon–Sun). Limit: $${settings.weeklyLimit}.`}
        />
        <DrawdownBar
          label="Max Drawdown"
          used={monthlyDrawdown}
          limit={settings.maxLimit}
          period="This Month"
          tooltip={`Maximum drawdown allowed by ${settings.company}: $${settings.maxLimit}${preset?.trailing ? " (trailing from peak balance)" : " (static from starting balance)"}.`}
        />
      </div>

      {/* Session Performance */}
      {pnlStats.sessionPerf.length > 0 && (
        <div
          className="p-6 rounded-2xl space-y-4"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        >
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
            Session Performance
          </p>
          <div className="space-y-3">
            {pnlStats.sessionPerf.map((s) => {
              const maxAbs = Math.max(...pnlStats.sessionPerf.map((x) => Math.abs(x.pnl)));
              const barW = maxAbs > 0 ? (Math.abs(s.pnl) / maxAbs) * 100 : 0;
              return (
                <div key={s.name} className="flex items-center gap-4">
                  <span
                    className="w-20 text-[10px] font-black uppercase tracking-widest shrink-0 truncate"
                    style={{ color: "var(--app-muted-color)" }}
                  >
                    {s.name}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--app-border)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${barW}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      style={{ background: s.pnl >= 0 ? "var(--app-success)" : "var(--app-danger)" }}
                    />
                  </div>
                  <span
                    className="w-20 text-right text-xs font-black shrink-0"
                    style={{ color: s.pnl >= 0 ? "var(--app-success)" : "var(--app-danger)" }}
                  >
                    {currency(s.pnl)}
                  </span>
                  <span
                    className="text-[10px] font-bold shrink-0"
                    style={{ color: "var(--app-muted-color)" }}
                  >
                    {s.count}T
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No trades state */}
      {trades.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-10 rounded-2xl gap-3"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        >
          <TrendingDown size={32} style={{ color: "var(--app-muted-color)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
            No trades loaded yet — connect your Notion database to see live drawdown data.
          </p>
        </div>
      )}
    </div>
  );
}
