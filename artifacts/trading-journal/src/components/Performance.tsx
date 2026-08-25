import { useMemo } from "react";
import { Clock, Zap, Target, TrendingUp } from "lucide-react";
import EmotionalJournal from "./EmotionalJournal";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import DrawdownTracker from "./DrawdownTracker";

function numberValue(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function Performance({
  trades,
  isDarkMode,
}: {
  trades: any[];
  isDarkMode: boolean;
}) {
  const chartColors = {
    tooltip: isDarkMode ? "#1E293B" : "#FFFFFF",
    tooltipText: isDarkMode ? "#E2E8F0" : "#0F172A",
    text: isDarkMode ? "#94A3B8" : "#64748B",
    success: isDarkMode ? "#4ADE80" : "#22C55E",
    danger: isDarkMode ? "#F87171" : "#EF4444",
    primary: isDarkMode ? "#8B5CF6" : "#7C3AED",
  };

  const THEME_COLORS = [
    isDarkMode ? "#8B5CF6" : "#7C3AED",
    isDarkMode ? "#4ADE80" : "#22C55E",
    isDarkMode ? "#F87171" : "#EF4444",
    isDarkMode ? "#FB923C" : "#F97316",
    isDarkMode ? "#FBBF24" : "#F59E0B",
    isDarkMode ? "#60A5FA" : "#3B82F6",
  ];

  const sessionData = useMemo(() => {
    const sessions: Record<string, { name: string; count: number; pnl: number }> = {};
    trades.forEach((t) => {
      const session = t["Session"] || "Other";
      if (!sessions[session])
        sessions[session] = { name: session, count: 0, pnl: 0 };
      sessions[session].count++;
      sessions[session].pnl += numberValue(t["Profit/Loss"]);
    });
    return Object.values(sessions).sort((a, b) => b.count - a.count);
  }, [trades]);

  const pairData = useMemo(() => {
    const pairs: Record<string, { name: string; count: number; pnl: number }> = {};
    trades.forEach((t) => {
      const pair = t["Pairs"] || "Unknown";
      if (!pairs[pair]) pairs[pair] = { name: pair, count: 0, pnl: 0 };
      pairs[pair].count++;
      pairs[pair].pnl += numberValue(t["Profit/Loss"]);
    });
    return Object.values(pairs)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 5);
  }, [trades]);

  const winRate =
    trades.length > 0
      ? (trades.filter((t) => numberValue(t["Profit/Loss"]) > 0).length /
          trades.length) *
        100
      : 0;
  const winners = trades.filter((t) => numberValue(t["Profit/Loss"]) > 0);
  const losers = trades.filter((t) => numberValue(t["Profit/Loss"]) < 0);
  const avgProfit =
    winners.length > 0
      ? winners.reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0) /
        winners.length
      : 0;
  const avgLoss =
    losers.length > 0
      ? Math.abs(
          losers.reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0)
        ) / losers.length
      : 0;

  const statCards = [
    {
      icon: Clock,
      iconColor: "var(--app-primary)",
      label: "Avg. Winner",
      value: `$${avgProfit.toFixed(2)}`,
      valueColor: "var(--app-success)",
    },
    {
      icon: Zap,
      iconColor: "var(--app-danger)",
      label: "Avg. Loser",
      value: `$${avgLoss.toFixed(2)}`,
      valueColor: "var(--app-danger)",
    },
    {
      icon: Target,
      iconColor: "var(--app-primary)",
      label: "Expectancy",
      value: `$${((winRate / 100) * avgProfit - (1 - winRate / 100) * avgLoss).toFixed(2)}`,
      valueColor: "var(--app-text)",
    },
    {
      icon: TrendingUp,
      iconColor: "var(--app-success)",
      label: "Risk/Reward",
      value: (avgProfit / avgLoss || 0).toFixed(2),
      valueColor: "var(--app-text)",
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h2
          className="text-3xl font-black tracking-tight"
          style={{ color: "var(--app-text)" }}
        >
          Performance Analytics
        </h2>
        <p
          className="font-medium text-sm mt-1"
          style={{ color: "var(--app-muted-color)" }}
        >
          Deep dive into your trading psychology and results.
        </p>
      </header>

      {/* Drawdown Tracker — funded account risk management */}
      <DrawdownTracker trades={trades} />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--app-border)" }} />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <div key={i} className="glass-card p-6">
            <card.icon style={{ color: card.iconColor, marginBottom: "0.75rem" }} size={24} />
            <p
              className="text-[10px] font-black uppercase tracking-widest mb-1"
              style={{ color: "var(--app-muted-color)" }}
            >
              {card.label}
            </p>
            <h4
              className="text-2xl font-black"
              style={{ color: card.valueColor }}
              data-testid={`text-perf-${card.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
            >
              {card.value}
            </h4>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Session Pie Chart */}
        <div className="glass-card p-8">
          <h3
            className="font-bold mb-8 flex items-center gap-2"
            style={{ color: "var(--app-text)" }}
          >
            <Clock size={18} style={{ color: "var(--app-primary)" }} />
            Performance by Session
          </h3>
          {sessionData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center" style={{ color: "var(--app-muted-color)" }}>
              <p className="text-sm">No session data yet</p>
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sessionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="count"
                    stroke="none"
                  >
                    {sessionData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={THEME_COLORS[index % THEME_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: chartColors.tooltip,
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: chartColors.tooltipText,
                    }}
                    itemStyle={{ color: chartColors.tooltipText }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    wrapperStyle={{
                      fontSize: "10px",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Pair Bar Chart */}
        <div className="glass-card p-8">
          <h3
            className="font-bold mb-8 flex items-center gap-2"
            style={{ color: "var(--app-text)" }}
          >
            <Target size={18} style={{ color: "var(--app-success)" }} />
            Top Pairs by P&L
          </h3>
          {pairData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center" style={{ color: "var(--app-muted-color)" }}>
              <p className="text-sm">No pair data yet</p>
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pairData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={80}
                    tick={{ fontSize: 10, fontWeight: "bold", fill: chartColors.text }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{
                      fill: isDarkMode
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.05)",
                    }}
                    contentStyle={{
                      backgroundColor: chartColors.tooltip,
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: chartColors.tooltipText,
                    }}
                    itemStyle={{ color: chartColors.tooltipText }}
                    labelStyle={{ display: "none" }}
                  />
                  <Bar dataKey="pnl" radius={[0, 8, 8, 0]}>
                    {pairData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.pnl >= 0 ? chartColors.success : chartColors.danger}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Emotion breakdown */}
      {(() => {
        const emotions: Record<string, { count: number; pnl: number }> = {};
        trades.forEach((t) => {
          String(t["Emotion"] || "")
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean)
            .forEach((e) => {
              if (!emotions[e]) emotions[e] = { count: 0, pnl: 0 };
              emotions[e].count++;
              emotions[e].pnl += numberValue(t["Profit/Loss"]);
            });
        });
        const emotionData = Object.entries(emotions)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);

        if (emotionData.length === 0) return null;

        return (
          <div className="glass-card p-8">
            <h3
              className="font-bold mb-6 flex items-center gap-2"
              style={{ color: "var(--app-text)" }}
            >
              <Zap size={18} style={{ color: "var(--app-primary)" }} />
              Emotional Distribution
            </h3>
            <div className="flex flex-wrap gap-3">
              {emotionData.map((e, i) => (
                <div
                  key={e.name}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{
                    background: `color-mix(in srgb, ${THEME_COLORS[i % THEME_COLORS.length]} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${THEME_COLORS[i % THEME_COLORS.length]} 20%, transparent)`,
                  }}
                >
                  <span
                    className="text-xs font-black uppercase tracking-widest"
                    style={{ color: THEME_COLORS[i % THEME_COLORS.length] }}
                  >
                    {e.name}
                  </span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: "color-mix(in srgb, var(--app-bg) 50%, transparent)",
                      color: "var(--app-muted-color)",
                    }}
                  >
                    {e.count}x
                  </span>
                  <span
                    className="text-[10px] font-black"
                    style={{ color: e.pnl >= 0 ? "var(--app-success)" : "var(--app-danger)" }}
                  >
                    {e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Trade journal entries with expand/collapse and emotion highlights */}
      <EmotionalJournal trades={trades} />
    </div>
  );
}
