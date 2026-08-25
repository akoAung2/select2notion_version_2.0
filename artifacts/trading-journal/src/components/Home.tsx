import { useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowRight,
  Plus,
  BarChart2,
  List,
  BookOpen,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function currency(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);
}

function numberValue(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function WinRateRing({ winRate, count }: { winRate: number; count: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const filled = (winRate / 100) * circumference;
  const gap = circumference - filled;

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <div className="relative" style={{ width: 88, height: 88 }}>
        <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8C52FF" />
              <stop offset="100%" stopColor="#00d8ff" />
            </linearGradient>
          </defs>
          <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(140,82,255,0.12)" strokeWidth="7" />
          <circle
            cx="44" cy="44" r={r} fill="none"
            stroke="url(#ringGrad)" strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${gap}`}
            style={{ filter: "drop-shadow(0 0 6px rgba(140,82,255,0.7))" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
            {winRate.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>
        {count} Trades
      </span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value as number;
  return (
    <div
      className="px-3 py-2 rounded-xl text-xs font-bold"
      style={{
        background: "rgba(13,22,50,0.95)",
        border: "1px solid rgba(140,82,255,0.3)",
        color: val >= 0 ? "#00c897" : "#ff6b6b",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      }}
    >
      {label} · {val >= 0 ? "+" : ""}{currency(val)}
    </div>
  );
}

export default function Home({
  trades,
  setActiveTab,
  isDarkMode,
}: {
  trades: any[];
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
}) {
  const totalPnl = useMemo(
    () => trades.reduce((sum, t) => sum + numberValue(t["Profit/Loss"]), 0),
    [trades]
  );

  const wins = useMemo(
    () => trades.filter((t) => numberValue(t["Profit/Loss"]) > 0),
    [trades]
  );
  const losses = useMemo(
    () => trades.filter((t) => numberValue(t["Profit/Loss"]) < 0),
    [trades]
  );

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const grossProfit = wins.reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const chartData = useMemo(() => {
    let balance = 0;
    return trades.slice(-21).map((t, i) => {
      balance += numberValue(t["Profit/Loss"]);
      return { name: `T${i + 1}`, value: parseFloat(balance.toFixed(2)) };
    });
  }, [trades]);

  const miniChartData = useMemo(() => chartData.slice(-10), [chartData]);

  const tools = [
    { id: "dashboard",     label: "Journal",   desc: "Detailed trade log",   icon: BookOpen,   accent: "#8C52FF" },
    { id: "performance",   label: "Analytics", desc: "Advanced stats.",       icon: BarChart2,  accent: "#00d8ff" },
    { id: "recent-trades", label: "Trades",    desc: "Full trade history.",   icon: List,       accent: "#00c897" },
    { id: "new-trade",     label: "New Trade", desc: "Add entry.",            icon: Plus,       accent: "#ff6b6b" },
  ];

  const isProfit = totalPnl >= 0;

  return (
    <div className="space-y-6">
      {/* ── Hero Banner ───────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-3xl"
        style={{
          background: isDarkMode
            ? "linear-gradient(135deg, rgba(10,16,38,0.95) 0%, rgba(18,8,45,0.95) 100%)"
            : "linear-gradient(135deg, rgba(240,235,255,0.95) 0%, rgba(225,210,255,0.9) 100%)",
          border: "1px solid rgba(140,82,255,0.18)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(140,82,255,0.08)",
          minHeight: 220,
        }}
      >
        {/* Radial orbs */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "-30%", left: "-10%",
            width: 380, height: 380,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(140,82,255,0.28) 0%, transparent 65%)",
            filter: "blur(40px)",
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: "-20%", right: "30%",
            width: 260, height: 260,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,216,255,0.18) 0%, transparent 65%)",
            filter: "blur(35px)",
          }}
        />

        <div className="relative z-10 flex items-center justify-between p-8 gap-6 bg-[#00000000]">
          {/* Left content */}
          <div className="flex-1 min-w-0">
            {/* Pill badge */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
              style={{
                background: "rgba(140,82,255,0.15)",
                border: "1px solid rgba(140,82,255,0.3)",
                backdropFilter: "blur(12px)",
              }}
            >
              <Plus size={11} color="#8C52FF" />
              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "#8C52FF" }}>
                {trades.length > 0 ? `${trades.length} Trades Logged` : "Ready to Track"}
              </span>
            </div>

            <h1 className="text-4xl font-black tracking-tighter leading-tight mb-3">
              <span style={{ color: "var(--app-text)" }}>Your Trading,</span>
              <br />
              <span
                style={{
                  background: "linear-gradient(90deg, #8C52FF 0%, #00d8ff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Elevated.
              </span>
            </h1>

            <p className="text-sm mb-6 max-w-sm" style={{ color: isDarkMode ? "rgba(216,228,248,0.6)" : "rgba(60,40,100,0.65)" }}>
              Track every setup, master your emotions, and scale your
              performance with the ultimate trading journal.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setActiveTab("new-trade")}
                className="btn-primary flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest"
                data-testid="button-log-trade"
              >
                <Plus size={14} />
                Log New Trade
              </button>
              <button
                onClick={() => setActiveTab("dashboard")}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(140,82,255,0.25)",
                  color: isDarkMode ? "rgba(216,228,248,0.7)" : "rgba(60,40,100,0.7)",
                }}
                data-testid="button-view-dashboard"
              >
                View all <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Right: mini equity curve */}
          {trades.length > 1 && (
            <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0 w-44">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "rgba(140,82,255,0.6)" }}>
                  Equity Curve
                </span>
                <span
                  className="text-xs font-black"
                  style={{ color: isProfit ? "#00c897" : "#ff6b6b" }}
                >
                  {isProfit ? "+" : ""}{currency(totalPnl)}
                </span>
              </div>
              <div style={{ width: "100%", height: 72 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={miniChartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8C52FF" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#8C52FF" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone" dataKey="value"
                      stroke="#8C52FF" fill="url(#miniGrad)"
                      strokeWidth={2} dot={false}
                      style={{ filter: "drop-shadow(0 0 4px rgba(140,82,255,0.7))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ── 4 Stat Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Monthly P&L */}
        <div className="stat-card flex flex-col gap-3 bg-[#ffffff00]">
          <div className="flex items-start justify-between">
            <div
              className="p-2 rounded-xl"
              style={{ background: "rgba(140,82,255,0.12)", color: "#8C52FF" }}
            >
              <Activity size={16} />
            </div>
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
              style={{
                background: isProfit ? "rgba(0,200,151,0.12)" : "rgba(255,107,107,0.12)",
                color: isProfit ? "#00c897" : "#ff6b6b",
                border: isProfit ? "1px solid rgba(0,200,151,0.25)" : "1px solid rgba(255,107,107,0.25)",
              }}
            >
              {isProfit ? "Profitable" : "Drawdown"}
            </span>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
              Monthly P&amp;L
            </p>
            <p
              className="text-2xl font-black tracking-tight font-data tabular-nums"
              style={{ color: isProfit ? "#00c897" : "#ff6b6b" }}
              data-testid="text-total-pnl"
            >
              {isProfit ? "+" : ""}{currency(totalPnl)}
            </p>
          </div>
        </div>

        {/* Win Rate ring */}
        <div className="stat-card flex items-center justify-center bg-[#ffffff00]">
          <div className="flex flex-col items-center gap-1 w-full">
            <WinRateRing winRate={winRate} count={trades.length} />
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
              Win Rate
            </p>
          </div>
        </div>

        {/* Total Wins */}
        <div className="stat-card flex flex-col gap-3 bg-[#ffffff00]">
          <div className="flex items-start justify-between">
            <div
              className="p-2 rounded-xl"
              style={{ background: "rgba(0,200,151,0.12)", color: "#00c897" }}
            >
              <TrendingUp size={16} />
            </div>
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
              style={{
                background: "rgba(0,200,151,0.12)",
                color: "#00c897",
                border: "1px solid rgba(0,200,151,0.25)",
              }}
            >
              {wins.length} Wins
            </span>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
              Total Wins
            </p>
            <p className="text-2xl font-black tracking-tight font-data tabular-nums" style={{ color: "#00c897" }}>
              {grossProfit > 0 ? "+" : ""}{currency(grossProfit)}
            </p>
          </div>
        </div>

        {/* Profit Factor */}
        <div className="stat-card flex flex-col gap-3 bg-[#ffffff00]">
          <div className="flex items-start justify-between">
            <div
              className="p-2 rounded-xl"
              style={{ background: "rgba(0,216,255,0.1)", color: "#00d8ff" }}
            >
              <BarChart2 size={16} />
            </div>
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
              style={{
                background: "rgba(0,216,255,0.1)",
                color: "#00d8ff",
                border: "1px solid rgba(0,216,255,0.22)",
              }}
            >
              Factor
            </span>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
              Profit Factor
            </p>
            <p className="text-2xl font-black tracking-tight font-data tabular-nums" style={{ color: "var(--app-text)" }}>
              {profitFactor === Infinity ? "∞" : profitFactor > 0 ? profitFactor.toFixed(2) : "—"}
            </p>
          </div>
        </div>
      </div>
      {/* ── Log New Trade Card ────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-2xl flex items-center gap-5 px-6 py-5 border-t-[#8c52ff5e] border-r-[#8c52ff5e] border-b-[#8c52ff5e] border-l-[#8c52ff5e] bg-[#0d163200]"
        style={{
          background: "var(--app-card)",
          border: "1px solid var(--app-border)",
          backdropFilter: "blur(24px)",
        }}
      >
        {/* Left accent bar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
          style={{ background: "linear-gradient(180deg, #8C52FF 0%, #00d8ff 100%)" }}
        />
        <div
          className="p-3 rounded-2xl flex-shrink-0 ml-2"
          style={{ background: "rgba(140,82,255,0.12)", color: "#8C52FF" }}
        >
          <BookOpen size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
            Log New Trade
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--app-muted-color)" }}>
            Document your setup, psychology, and outcome
          </p>
        </div>
        <button
          onClick={() => setActiveTab("new-trade")}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest flex-shrink-0"
          data-testid="button-log-trade-card"
        >
          Log Trade <ArrowRight size={14} />
        </button>
      </div>
      {/* ── Equity Curve ─────────────────────────────────────────── */}
      {trades.length > 1 && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            backdropFilter: "blur(24px)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>
                Equity Curve
              </h2>
              <p className="text-[10px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
                Last {chartData.length} trades
              </p>
            </div>
            <button
              onClick={() => setActiveTab("performance")}
              className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: "rgba(140,82,255,0.12)",
                color: "#8C52FF",
                border: "1px solid rgba(140,82,255,0.25)",
              }}
              data-testid="button-full-analytics"
            >
              Full Analytics
            </button>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8C52FF" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#8C52FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,82,255,0.07)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--app-muted-color)", fontSize: 9, fontWeight: 700 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted-color)", fontSize: 9, fontWeight: 700 }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone" dataKey="value"
                  stroke="#8C52FF" fill="url(#equityGrad)"
                  strokeWidth={2} dot={false}
                  style={{ filter: "drop-shadow(0 0 6px rgba(140,82,255,0.65))" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {/* ── Quick Tool Grid ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTab(tool.id)}
            className="glass-card p-5 flex flex-col items-start gap-3 transition-all cursor-pointer group text-left"
            data-testid={`button-tool-${tool.id}`}
          >
            <div
              className="p-2.5 rounded-xl transition-transform group-hover:scale-110"
              style={{
                background: `${tool.accent}18`,
                color: tool.accent,
                boxShadow: `0 0 12px ${tool.accent}30`,
              }}
            >
              <tool.icon size={20} />
            </div>
            <div>
              <p className="font-black text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
                {tool.label}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--app-muted-color)" }}>
                {tool.desc}
              </p>
            </div>
          </button>
        ))}
      </div>
      {/* ── Recent Entries ────────────────────────────────────────── */}
      {trades.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>
              Recent Entries
            </h2>
            <button
              onClick={() => setActiveTab("dashboard")}
              className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: "rgba(140,82,255,0.1)",
                color: "#8C52FF",
                border: "1px solid rgba(140,82,255,0.22)",
              }}
              data-testid="button-view-all-trades"
            >
              View All
            </button>
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", backdropFilter: "blur(24px)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--app-border)" }}>
                    {["Name", "Pair", "Direction", "P&L", "Date"].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3.5 text-[9px] font-black uppercase tracking-widest"
                        style={{ color: "var(--app-muted-color)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades
                    .slice(-5)
                    .reverse()
                    .map((trade) => {
                      const pnl = numberValue(trade["Profit/Loss"]);
                      const isBuy = trade["Direction"] === "Buy";
                      return (
                        <tr
                          key={trade.id}
                          className="transition-colors cursor-pointer hover:bg-[rgba(140,82,255,0.04)]"
                          style={{ borderBottom: "1px solid var(--app-border)" }}
                          data-testid={`row-trade-${trade.id}`}
                        >
                          <td className="px-5 py-4">
                            <span className="font-bold text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
                              {trade["Name"]}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                              style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
                            >
                              {trade["Pairs"]}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            {isBuy ? (
                              <span className="badge-long">
                                <TrendingUp size={9} />
                                Long
                              </span>
                            ) : (
                              <span className="badge-short">
                                <TrendingDown size={9} />
                                Short
                              </span>
                            )}
                          </td>
                          <td
                            className="px-5 py-4 font-black text-sm tracking-tight"
                            style={{ color: pnl >= 0 ? "#00c897" : "#ff6b6b" }}
                          >
                            {pnl >= 0 ? "+" : ""}{currency(pnl)}
                          </td>
                          <td className="px-5 py-4">
                            <span className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--app-muted-color)" }}>
                              {trade["Date"]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
