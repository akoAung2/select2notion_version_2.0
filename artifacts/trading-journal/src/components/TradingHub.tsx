import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart2,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  Award,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  Legend,
} from "recharts";
import { useAccount } from "../context/AccountContext";
import { useGetNotionSchema } from "@workspace/api-client-react";

const ACCOUNT_PROPERTY_NAMES = ["Trading Account", "Account", "trading account", "account"];

function getPnL(trade: any): number {
  const keys = ["Profit/Loss", "PnL", "P&L", "pnl", "profit", "Profit"];
  for (const k of keys) {
    if (trade[k] !== undefined && trade[k] !== null && trade[k] !== "") {
      const n = Number(trade[k]);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function getAccountName(trade: any): string | null {
  for (const k of ACCOUNT_PROPERTY_NAMES) {
    if (trade[k]) return String(trade[k]);
  }
  return null;
}

interface AccountStats {
  account: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  bestTrade: number;
  worstTrade: number;
  longestWinStreak: number;
  color: string;
}

function computeStats(trades: any[], account: string, color: string): AccountStats {
  const accountTrades = trades.filter((t) => getAccountName(t) === account);
  const pnls = accountTrades.map(getPnL);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const total = accountTrades.length;
  const totalPnL = pnls.reduce((a, b) => a + b, 0);
  const avgPnL = total > 0 ? totalPnL / total : 0;
  const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
  const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;

  let longestWinStreak = 0;
  let curStreak = 0;
  for (const p of pnls) {
    if (p > 0) { curStreak++; longestWinStreak = Math.max(longestWinStreak, curStreak); }
    else curStreak = 0;
  }

  return {
    account,
    total,
    wins,
    losses,
    winRate: total > 0 ? (wins / total) * 100 : 0,
    totalPnL,
    avgPnL,
    bestTrade,
    worstTrade,
    longestWinStreak,
    color,
  };
}

function StatCompareCard({
  label,
  stats,
  getValue,
  format,
  higherIsBetter = true,
}: {
  label: string;
  stats: AccountStats[];
  getValue: (s: AccountStats) => number;
  format: (n: number) => string;
  higherIsBetter?: boolean;
}) {
  const values = stats.map((s) => getValue(s));
  const best = higherIsBetter ? Math.max(...values) : Math.min(...values);
  const worst = higherIsBetter ? Math.min(...values) : Math.max(...values);

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
    >
      <p className="text-[9px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>
        {label}
      </p>
      <div className="space-y-3">
        {stats.map((s) => {
          const val = getValue(s);
          const isBest = val === best;
          const isWorst = val === worst && stats.length > 1;
          const maxAbs = Math.max(...values.map(Math.abs));
          const pct = maxAbs > 0 ? Math.abs(val) / maxAbs : 0;
          return (
            <div key={s.account}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-xs font-bold" style={{ color: "var(--app-text)" }}>{s.account}</span>
                  {isBest && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg" style={{ background: "color-mix(in srgb, var(--app-success) 12%, transparent)", color: "var(--app-success)" }}>Best</span>}
                </div>
                <span
                  className="text-sm font-black"
                  style={{ color: val > 0 ? "var(--app-success)" : val < 0 ? "var(--app-danger)" : "var(--app-text)" }}
                >
                  {format(val)}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--app-bg)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct * 100}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: val < 0 ? "var(--app-danger)" : s.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountCard({ stat }: { stat: AccountStats }) {
  const pnlPos = stat.totalPnL >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl p-6"
      style={{ background: "var(--app-card)", border: `1px solid var(--app-border)` }}
    >
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: stat.color, boxShadow: `0 0 8px ${stat.color}` }}
          />
          <div>
            <h3 className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>{stat.account}</h3>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
              {stat.total} trade{stat.total !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div
          className="px-3 py-1.5 rounded-xl text-base font-black"
          style={{
            background: pnlPos
              ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
              : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
            color: pnlPos ? "var(--app-success)" : "var(--app-danger)",
          }}
        >
          {pnlPos ? "+" : ""}{stat.totalPnL.toFixed(2)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Win Rate", val: `${stat.winRate.toFixed(0)}%`, good: stat.winRate >= 50 },
          { label: "Avg P&L", val: `${stat.avgPnL >= 0 ? "+" : ""}${stat.avgPnL.toFixed(2)}`, good: stat.avgPnL >= 0 },
          { label: "Best Trade", val: `+${stat.bestTrade.toFixed(2)}`, good: true },
          { label: "Win Streak", val: `${stat.longestWinStreak}`, good: stat.longestWinStreak > 0 },
        ].map(({ label, val, good }) => (
          <div
            key={label}
            className="rounded-xl p-3"
            style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}
          >
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>{label}</p>
            <p className="text-sm font-black" style={{ color: good ? "var(--app-success)" : "var(--app-danger)" }}>{val}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function TradingHub({ trades }: { trades: any[] }) {
  const { accounts, accountColors } = useAccount();
  const { data: schemaData } = useGetNotionSchema();

  const activeAccounts = useMemo(() => {
    if (accounts.length === 0) {
      const fromTrades = [...new Set(trades.map(getAccountName).filter(Boolean))] as string[];
      return fromTrades;
    }
    return accounts;
  }, [accounts, trades]);

  const allStats = useMemo<AccountStats[]>(() => {
    return activeAccounts.map((a) => computeStats(trades, a, accountColors[a] ?? "var(--app-primary)"));
  }, [activeAccounts, trades, accountColors]);

  const unassignedTrades = useMemo(() => {
    return trades.filter((t) => !getAccountName(t));
  }, [trades]);

  const barData = useMemo(() => {
    return allStats.map((s) => ({
      name: s.account.length > 10 ? s.account.slice(0, 10) + "…" : s.account,
      "Total P&L": parseFloat(s.totalPnL.toFixed(2)),
      "Win Rate %": parseFloat(s.winRate.toFixed(1)),
      Trades: s.total,
    }));
  }, [allStats]);

  const radarData = useMemo(() => {
    const metrics = ["Win Rate", "Avg P&L", "Best Trade", "Total Trades", "Streak"];
    const maxVals = {
      "Win Rate": Math.max(...allStats.map((s) => s.winRate), 1),
      "Avg P&L": Math.max(...allStats.map((s) => Math.abs(s.avgPnL)), 1),
      "Best Trade": Math.max(...allStats.map((s) => s.bestTrade), 1),
      "Total Trades": Math.max(...allStats.map((s) => s.total), 1),
      Streak: Math.max(...allStats.map((s) => s.longestWinStreak), 1),
    };
    return metrics.map((m) => {
      const row: any = { metric: m };
      allStats.forEach((s) => {
        let raw = 0;
        if (m === "Win Rate") raw = s.winRate;
        else if (m === "Avg P&L") raw = Math.abs(s.avgPnL);
        else if (m === "Best Trade") raw = s.bestTrade;
        else if (m === "Total Trades") raw = s.total;
        else if (m === "Streak") raw = s.longestWinStreak;
        row[s.account] = maxVals[m as keyof typeof maxVals] > 0
          ? (raw / maxVals[m as keyof typeof maxVals]) * 100
          : 0;
      });
      return row;
    });
  }, [allStats]);

  if (activeAccounts.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>Trading Hub</h2>
          <p className="text-sm font-medium mt-1" style={{ color: "var(--app-muted-color)" }}>Smart multi-account comparison</p>
        </div>
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        >
          <BarChart2 size={40} className="mx-auto mb-4" style={{ color: "var(--app-muted-color)" }} />
          <h3 className="font-black text-xl mb-2" style={{ color: "var(--app-text)" }}>No Accounts Detected</h3>
          <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--app-muted-color)" }}>
            Add a <strong>"Trading Account"</strong> select property to your Notion database to enable multi-account comparison.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex text-left justify-between items-start mb-[33px] pt-[0px] pb-[0px] pl-[0px] pr-[0px] flex-col">
        <div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>Trading Hub</h2>
          <p className="text-sm font-medium mt-1" style={{ color: "var(--app-muted-color)" }}>
            Smart comparison across {activeAccounts.length} account{activeAccounts.length !== 1 ? "s" : ""} · {trades.length} total trades
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeAccounts.map((a) => (
            <div key={a} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: accountColors[a] ?? "var(--app-primary)" }} />
              <span className="text-xs font-bold" style={{ color: "var(--app-muted-color)" }}>{a}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {allStats.map((s) => <AccountCard key={s.account} stat={s} />)}
        {unassignedTrades.length > 0 && (
          <div
            className="rounded-2xl p-6 flex flex-col items-center justify-center text-center"
            style={{ background: "var(--app-card)", border: `1px dashed var(--app-border)` }}
          >
            <Target size={24} className="mb-2" style={{ color: "var(--app-muted-color)" }} />
            <p className="text-sm font-bold" style={{ color: "var(--app-text)" }}>{unassignedTrades.length} Unassigned</p>
            <p className="text-xs mt-1" style={{ color: "var(--app-muted-color)" }}>Trades without an account tag</p>
          </div>
        )}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart — P&L comparison */}
        <div
          className="rounded-2xl p-6"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        >
          <p className="text-[10px] font-black uppercase tracking-widest mb-5" style={{ color: "var(--app-muted-color)" }}>
            Total P&L by Account
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--app-muted-color)", fontWeight: 700 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--app-muted-color)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "var(--app-text)", fontWeight: 700 }}
                itemStyle={{ color: "var(--app-text)" }}
              />
              {allStats.map((s) => (
                <Bar key={s.account} dataKey="Total P&L" fill={s.color} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar chart */}
        {allStats.length >= 2 && radarData.length > 0 && (
          <div
            className="rounded-2xl p-6"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
          >
            <p className="text-[10px] font-black uppercase tracking-widest mb-5" style={{ color: "var(--app-muted-color)" }}>
              Performance Profile
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="var(--app-border)" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "var(--app-muted-color)", fontWeight: 700 }} />
                {allStats.map((s) => (
                  <Radar
                    key={s.account}
                    name={s.account}
                    dataKey={s.account}
                    stroke={s.color}
                    fill={s.color}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 12 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {/* Comparison grid */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>
          Head-to-Head Comparison
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <StatCompareCard
            label="Total P&L"
            stats={allStats}
            getValue={(s) => s.totalPnL}
            format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`}
          />
          <StatCompareCard
            label="Win Rate"
            stats={allStats}
            getValue={(s) => s.winRate}
            format={(n) => `${n.toFixed(0)}%`}
          />
          <StatCompareCard
            label="Avg P&L per Trade"
            stats={allStats}
            getValue={(s) => s.avgPnL}
            format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`}
          />
          <StatCompareCard
            label="Best Single Trade"
            stats={allStats}
            getValue={(s) => s.bestTrade}
            format={(n) => `+${n.toFixed(2)}`}
          />
          <StatCompareCard
            label="Total Trades"
            stats={allStats}
            getValue={(s) => s.total}
            format={(n) => `${n}`}
          />
          <StatCompareCard
            label="Longest Win Streak"
            stats={allStats}
            getValue={(s) => s.longestWinStreak}
            format={(n) => `${n} trades`}
          />
        </div>
      </div>
    </div>
  );
}
