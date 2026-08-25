import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  Users,
  Search,
  Share2,
  Star,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
  X,
  Calendar,
  Filter,
} from "lucide-react";
import { TradingViewCard, ChartModal, isValidTradingViewUrl } from "./TradingViewPreview";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import PnLCalendar from "./PnLCalendar";
import EditTradeModal from "./EditTradeModal";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTradesQueryKey, useDeleteTrade } from "@workspace/api-client-react";

function currency(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
}

function numberValue(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const EMOTION_PREVIEW_LEN = 45;

function EmotionCell({ tradeId, emotion }: { tradeId: string; emotion: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = String(emotion || "");
  const needsExpand = text.length > EMOTION_PREVIEW_LEN;
  const preview = needsExpand ? text.slice(0, EMOTION_PREVIEW_LEN) + "…" : text;

  if (!text) {
    return <span style={{ color: "var(--app-muted-color)", fontSize: "12px" }}>—</span>;
  }

  return (
    <div style={{ maxWidth: 220 }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={expanded ? "expanded" : "collapsed"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="flex flex-wrap gap-1">
            {(expanded ? text : preview)
              .split(",")
              .map((e) => e.trim())
              .filter(Boolean)
              .map((emotion, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest"
                  style={{
                    background: "color-mix(in srgb, var(--app-primary) 5%, transparent)",
                    color: "var(--app-primary)",
                    border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                  }}
                >
                  {emotion}
                </span>
              ))}
          </div>
        </motion.div>
      </AnimatePresence>
      {needsExpand && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-0.5 transition-colors"
          style={{ color: "var(--app-muted-color)", fontSize: "10px", fontWeight: 700 }}
          title={expanded ? "Collapse" : "Show all"}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  isPositive,
  Icon,
  sparklineData,
}: {
  label: string;
  value: string;
  isPositive: boolean;
  Icon: any;
  sparklineData: number[];
}) {
  return (
    <div className="stat-card group bg-[#ffffff00]">
      <div className="flex justify-between items-start mb-4">
        <div
          className="p-3 rounded-2xl transition-transform group-hover:scale-110"
          style={{
            background: isPositive
              ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
              : "color-mix(in srgb, var(--app-danger) 10%, transparent)",
            color: isPositive ? "var(--app-success)" : "var(--app-danger)",
          }}
        >
          <Icon size={22} />
        </div>
        <div className="h-8 w-16 overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData.map((v, i) => ({ v, i }))}>
              <Area
                type="monotone"
                dataKey="v"
                stroke={isPositive ? "var(--app-success)" : "var(--app-danger)"}
                fill={isPositive ? "var(--app-success)" : "var(--app-danger)"}
                fillOpacity={0.1}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p
        className="text-[10px] font-black uppercase tracking-widest mb-1"
        style={{ color: "var(--app-muted-color)" }}
      >
        {label}
      </p>
      <h3
        className="text-2xl font-black tracking-tight font-data tabular-nums"
        style={{ color: "var(--app-text)" }}
        data-testid={`stat-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
      >
        {value}
      </h3>
    </div>
  );
}

// ── Direction normalizer — handles Buy/BUY/Long/LONG/Bullish and Sell/SELL/Short/SHORT/Bearish ──
function normalizeDirection(dir: any): "Buy" | "Sell" | null {
  const d = String(dir ?? "").toLowerCase().trim();
  if (d === "buy" || d === "long" || d === "bullish") return "Buy";
  if (d === "sell" || d === "short" || d === "bearish") return "Sell";
  return null;
}

// ── RR property name candidates (user-specific Notion schema) ──
const RR_PROP_NAMES = ["RR", "R:R", "Risk Reward", "Risk/Reward", "RR Ratio", "r:r", "rr"];
function getTradeRR(t: any): number | null {
  for (const key of RR_PROP_NAMES) {
    const v = Number(t[key]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return null;
}

export default function Dashboard({
  trades,
  isDarkMode,
}: {
  trades: any[];
  isDarkMode: boolean;
}) {
  const [searchMode, setSearchMode] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [filters, setFilters] = useState({
    direction: "",
    pair: "",
    rating: 0,
    startDate: "",
    endDate: "",
    exactDate: "",
    pnl: "",
  });
  const [editingTrade, setEditingTrade] = useState<any | null>(null);
  const [deletingTrade, setDeletingTrade] = useState<any | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [chartUrl, setChartUrl] = useState<string | null>(null);

  const qClient = useQueryClient();
  const deleteTrade = useDeleteTrade();

  const chartColors = {
    primary: isDarkMode ? "#8B5CF6" : "#7C3AED",
    tooltip: isDarkMode ? "#1E293B" : "#FFFFFF",
    tooltipText: isDarkMode ? "#E2E8F0" : "#0F172A",
    text: isDarkMode ? "#94A3B8" : "#64748B",
    muted: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
  };

  const filteredTrades = useMemo(() => {
    const seen = new Set<string>();
    return trades.filter((t) => {
      if (t.id && seen.has(String(t.id))) return false;
      if (t.id) seen.add(String(t.id));

      const q = searchQuery.toLowerCase();
      const matchSearch = !searchQuery || (() => {
        if (searchMode === "pair") return String(t["Pairs"] || "").toLowerCase().includes(q);
        return (
          String(t["Name"] || "").toLowerCase().includes(q) ||
          String(t["Pairs"] || "").toLowerCase().includes(q) ||
          String(t["Session"] || "").toLowerCase().includes(q) ||
          String(t["Direction"] || "").toLowerCase().includes(q)
        );
      })();
      const matchDir = !filters.direction || t["Direction"] === filters.direction;
      const matchPair = !filters.pair || String(t["Pairs"] || "").toLowerCase().includes(filters.pair.toLowerCase());
      const matchRating = !filters.rating || numberValue(t["Rating(1-5)"]) >= filters.rating;
      const matchStart = !filters.startDate || (t["Date"] || "") >= filters.startDate;
      const matchEnd = !filters.endDate || (t["Date"] || "") <= filters.endDate;
      const matchExactDate = !filters.exactDate || (t["Date"] || "") === filters.exactDate;
      const matchPnl = !filters.pnl || (
        filters.pnl === "profit" ? numberValue(t["Profit/Loss"]) > 0 : numberValue(t["Profit/Loss"]) < 0
      );
      return matchSearch && matchDir && matchPair && matchRating && matchStart && matchEnd && matchExactDate && matchPnl;
    });
  }, [trades, searchQuery, searchMode, filters]);

  const totalPnl = filteredTrades.reduce(
    (s, t) => s + numberValue(t["Profit/Loss"]),
    0
  );
  const winRate =
    filteredTrades.length > 0
      ? (filteredTrades.filter((t) => numberValue(t["Profit/Loss"]) > 0)
          .length /
          filteredTrades.length) *
        100
      : 0;
  const grossProfit = filteredTrades
    .filter((t) => numberValue(t["Profit/Loss"]) > 0)
    .reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0);
  const grossLoss = Math.abs(
    filteredTrades
      .filter((t) => numberValue(t["Profit/Loss"]) < 0)
      .reduce((s, t) => s + numberValue(t["Profit/Loss"]), 0)
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

  const equityCurve = useMemo(() => {
    let balance = 0;
    return filteredTrades.map((t) => {
      balance += numberValue(t["Profit/Loss"]);
      return parseFloat(balance.toFixed(2));
    });
  }, [filteredTrades]);

  const equityChartData = equityCurve.map((v, i) => ({ i, v }));

  // ── Direction analytics — memoized, uses normalizeDirection for full variant coverage ──
  const dirAnalytics = useMemo(() => {
    const buy: any[] = [];
    const sell: any[] = [];
    for (const t of filteredTrades) {
      const dir = normalizeDirection(t["Direction"]);
      if (dir === "Buy") buy.push(t);
      else if (dir === "Sell") sell.push(t);
    }

    function analyze(bucket: any[]) {
      const pnls = bucket.map((t) => numberValue(t["Profit/Loss"]));
      const totalPnl = pnls.reduce((s, v) => s + v, 0);
      const wins = pnls.filter((v) => v > 0);
      const winRate = bucket.length > 0 ? (wins.length / bucket.length) * 100 : 0;
      const rrValues = bucket.map(getTradeRR).filter((v): v is number => v !== null);
      const averageRR = rrValues.length > 0 ? rrValues.reduce((s, v) => s + v, 0) / rrValues.length : null;
      const averageProfit = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : null;
      const maxWin = pnls.length > 0 ? Math.max(...pnls) : null;
      const maxLoss = pnls.length > 0 ? Math.min(...pnls) : null;
      return { count: bucket.length, totalPnl, winRate, averageRR, averageProfit, maxWin, maxLoss };
    }

    const buyStats = analyze(buy);
    const sellStats = analyze(sell);
    const winner: "BUY" | "SELL" | "TIE" =
      buyStats.totalPnl > sellStats.totalPnl ? "BUY" :
      sellStats.totalPnl > buyStats.totalPnl ? "SELL" : "TIE";
    const pnlDifference = Math.abs(buyStats.totalPnl - sellStats.totalPnl);
    return { buy: buyStats, sell: sellStats, winner, pnlDifference, buyBucket: buy, sellBucket: sell };
  }, [filteredTrades]);

  const buyTrades   = dirAnalytics.buyBucket;
  const sellTrades  = dirAnalytics.sellBucket;
  const buyPnl      = dirAnalytics.buy.totalPnl;
  const sellPnl     = dirAnalytics.sell.totalPnl;
  const buyWinRate  = dirAnalytics.buy.winRate;
  const sellWinRate = dirAnalytics.sell.winRate;
  const totalTrades = filteredTrades.length;

  const availablePairs = useMemo(
    () => [...new Set(trades.map((t) => t["Pairs"]).filter(Boolean))],
    [trades]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      {/* Edit Trade Modal */}
      {editingTrade && (
        <EditTradeModal
          trade={editingTrade}
          onClose={() => setEditingTrade(null)}
          onSaved={() => {
            qClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
            setEditingTrade(null);
          }}
        />
      )}
      {/* Delete Confirmation Modal */}
      {deletingTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleteTrade.isPending) { setDeletingTrade(null); setDeleteError(""); } }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="glass-card w-full max-w-sm p-8 flex flex-col gap-5"
            style={{ boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--app-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--app-danger) 25%, transparent)" }}>
                <Trash2 size={24} style={{ color: "var(--app-danger)" }} />
              </div>
              <h3 className="text-lg font-black tracking-tight" style={{ color: "var(--app-text)" }}>Delete Trade?</h3>
              <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                Are you sure you want to delete{" "}
                <span className="font-bold" style={{ color: "var(--app-text)" }}>
                  {deletingTrade["Name"] || "this entry"}
                </span>
                ? This will permanently archive it in Notion.
              </p>
            </div>

            {deleteError && (
              <div className="px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)",
                  color: "var(--app-danger)",
                }}>
                <AlertCircle size={14} /> {deleteError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setDeletingTrade(null); setDeleteError(""); }}
                disabled={deleteTrade.isPending}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)", opacity: deleteTrade.isPending ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleteError("");
                  try {
                    await deleteTrade.mutateAsync({ id: deletingTrade.id });
                    qClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
                    setDeletingTrade(null);
                  } catch (err: any) {
                    setDeleteError(err?.message || "Failed to delete trade. Please try again.");
                  }
                }}
                disabled={deleteTrade.isPending}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                style={{
                  background: "var(--app-danger)",
                  color: "white",
                  opacity: deleteTrade.isPending ? 0.7 : 1,
                }}
              >
                {deleteTrade.isPending ? (
                  <><Loader2 size={13} className="animate-spin" /> Deleting...</>
                ) : (
                  <><Trash2 size={13} /> Delete</>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Chart Modal */}
      {chartUrl && <ChartModal url={chartUrl} onClose={() => setChartUrl(null)} />}
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2
            className="text-[2.5rem] font-black tracking-tight leading-none mb-3 font-heading"
            style={{ color: "var(--app-text)" }}
          >
            Portfolio Edge
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "var(--app-success)", boxShadow: "0 0 8px var(--app-success)" }}
              />
              <span
                className="text-[10px] font-black tracking-widest uppercase"
                style={{ color: "var(--app-muted-color)" }}
              >
                Live Notion Sync
              </span>
            </div>
            <div className="w-1 h-1 rounded-full" style={{ background: "var(--app-border)" }} />
            <p className="font-medium text-sm" style={{ color: "var(--app-muted-color)" }}>
              Quantifying your psychological and execution performance.
            </p>
          </div>
        </div>

        {/* Smart Search — desktop */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Search by dropdown */}
          <div className="relative">
            <select
              value={searchMode}
              onChange={(e) => {
                setSearchMode(e.target.value);
                setSearchQuery("");
                setFilters((f) => ({ ...f, direction: "", pair: "", rating: 0, exactDate: "", pnl: "", startDate: "", endDate: "" }));
              }}
              className="appearance-none pl-3 pr-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer"
              style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-primary)" }}
              data-testid="select-search-mode"
            >
              <option value="all">All Fields</option>
              <option value="pair">Pair</option>
              <option value="direction">Direction</option>
              <option value="pnl">P&L</option>
              <option value="date">Date</option>
              <option value="rating">Rating</option>
              <option value="daterange">Date Range</option>
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-primary)" }} />
          </div>

          {/* Dynamic search input — changes by mode */}
          {(searchMode === "all" || searchMode === "pair") && (
            <div className="relative flex-1 md:flex-none">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-muted-color)" }} />
              <input
                type="text"
                placeholder={searchMode === "pair" ? "Filter by pair (e.g. EURUSD)..." : "Search journal entries..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 py-3 rounded-xl text-sm outline-none w-full md:w-64 font-medium transition-all"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-text)" }}
                data-testid="input-search-trades"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded" style={{ color: "var(--app-muted-color)" }}>
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {searchMode === "direction" && (
            <div className="flex gap-1.5">
              {["Buy", "Sell"].map((dir) => (
                <button
                  key={dir}
                  onClick={() => setFilters((f) => ({ ...f, direction: f.direction === dir ? "" : dir }))}
                  className="px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{
                    background: filters.direction === dir ? (dir === "Buy" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-card)",
                    border: `1px solid ${filters.direction === dir ? (dir === "Buy" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-border)"}`,
                    color: filters.direction === dir ? "white" : "var(--app-muted-color)",
                  }}
                  data-testid={`filter-dir-${dir.toLowerCase()}`}
                >
                  {dir === "Buy" ? "▲ Buy" : "▼ Sell"}
                </button>
              ))}
            </div>
          )}

          {searchMode === "pnl" && (
            <div className="flex gap-1.5">
              {(["profit", "loss"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFilters((f) => ({ ...f, pnl: f.pnl === mode ? "" : mode }))}
                  className="px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{
                    background: filters.pnl === mode ? (mode === "profit" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-card)",
                    border: `1px solid ${filters.pnl === mode ? (mode === "profit" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-border)"}`,
                    color: filters.pnl === mode ? "white" : "var(--app-muted-color)",
                  }}
                >
                  {mode === "profit" ? "✓ Profit" : "✗ Loss"}
                </button>
              ))}
            </div>
          )}

          {searchMode === "date" && (
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-muted-color)" }} />
              <input
                type="date"
                value={filters.exactDate}
                onChange={(e) => setFilters((f) => ({ ...f, exactDate: e.target.value }))}
                className="pl-9 pr-3 py-3 rounded-xl text-sm outline-none font-medium"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-text)" }}
                data-testid="filter-exact-date"
              />
            </div>
          )}

          {searchMode === "daterange" && (
            <div className="flex items-center gap-2">
              <input type="date" value={filters.startDate}
                onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                className="py-3 px-3 rounded-xl text-xs outline-none font-medium"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-text)", width: 140 }}
              />
              <span className="text-[10px] font-black" style={{ color: "var(--app-muted-color)" }}>TO</span>
              <input type="date" value={filters.endDate}
                onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                className="py-3 px-3 rounded-xl text-xs outline-none font-medium"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-text)", width: 140 }}
              />
            </div>
          )}

          {searchMode === "rating" && (
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFilters((f) => ({ ...f, rating: f.rating === star ? 0 : star }))}
                  style={{ color: star <= filters.rating ? "#EAB308" : "var(--app-border)", transform: star <= filters.rating ? "scale(1.15)" : "scale(1)" }}
                  className="transition-all duration-200"
                  data-testid={`filter-star-${star}`}
                >
                  <Star size={22} fill={star <= filters.rating ? "currentColor" : "none"} strokeWidth={1.5} />
                </button>
              ))}
            </div>
          )}

          {/* Mobile filter button */}
          <button
            onClick={() => setShowMobileFilters(true)}
            className="md:hidden p-3 rounded-xl flex items-center gap-1.5 transition-all"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
          >
            <Filter size={16} />
          </button>

          {/* Clear all */}
          {(searchQuery || filters.direction || filters.pair || filters.rating || filters.startDate || filters.endDate || filters.exactDate || filters.pnl) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setFilters({ direction: "", pair: "", rating: 0, startDate: "", endDate: "", exactDate: "", pnl: "" });
              }}
              className="flex items-center gap-1.5 px-3 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: "color-mix(in srgb, var(--app-danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)", color: "var(--app-danger)" }}
              data-testid="button-clear-filters"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>
      {/* Search result summary banner */}
      {(searchQuery || filters.direction || filters.pair || filters.rating || filters.exactDate || filters.pnl || filters.startDate) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card px-5 py-4 flex flex-wrap items-center gap-4"
          style={{ borderColor: "color-mix(in srgb, var(--app-primary) 25%, transparent)", background: "color-mix(in srgb, var(--app-primary) 3%, transparent)" }}
        >
          <SlidersHorizontal size={15} style={{ color: "var(--app-primary)", flexShrink: 0 }} />
          <div className="flex flex-wrap gap-3 flex-1">
            {[
              { label: "Trades Found", value: String(filteredTrades.length), color: "var(--app-text)" },
              { label: "Win Rate", value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? "var(--app-success)" : "var(--app-danger)" },
              { label: "Total P&L", value: currency(totalPnl), color: totalPnl >= 0 ? "var(--app-success)" : "var(--app-danger)" },
              ...(filters.direction ? [{ label: "Direction", value: filters.direction, color: "var(--app-primary)" }] : []),
              ...(filters.pnl ? [{ label: "P&L Filter", value: filters.pnl === "profit" ? "Profitable" : "Losing", color: "var(--app-primary)" }] : []),
              ...(filters.exactDate ? [{ label: "Date", value: filters.exactDate, color: "var(--app-primary)" }] : []),
              ...(searchQuery ? [{ label: "Query", value: `"${searchQuery}"`, color: "var(--app-primary)" }] : []),
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>{label}</span>
                <span className="text-sm font-black" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => { setSearchQuery(""); setFilters({ direction: "", pair: "", rating: 0, startDate: "", endDate: "", exactDate: "", pnl: "" }); }}
            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all"
            style={{ color: "var(--app-muted-color)", border: "1px solid var(--app-border)" }}
          >
            Clear All
          </button>
        </motion.div>
      )}
      {/* Mobile slide-up filter panel */}
      <AnimatePresence>
        {showMobileFilters && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setShowMobileFilters(false)}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl p-6 flex flex-col gap-5"
              style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", maxHeight: "85vh", overflowY: "auto" }}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-black tracking-tight" style={{ color: "var(--app-text)" }}>Filter Trades</h3>
                <button onClick={() => setShowMobileFilters(false)} className="p-2 rounded-xl" style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <X size={18} />
                </button>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Search</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted-color)" }} />
                  <input type="text" placeholder="Search entries..." value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-4 py-3 w-full rounded-xl text-sm font-medium outline-none"
                    style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-text)" }}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Direction</label>
                <div className="flex gap-2">
                  {["Buy", "Sell"].map((dir) => (
                    <button key={dir} onClick={() => setFilters((f) => ({ ...f, direction: f.direction === dir ? "" : dir }))}
                      className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                      style={{
                        background: filters.direction === dir ? (dir === "Buy" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-bg)",
                        border: `1px solid ${filters.direction === dir ? (dir === "Buy" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-border)"}`,
                        color: filters.direction === dir ? "white" : "var(--app-muted-color)",
                      }}>
                      {dir === "Buy" ? "▲ Buy" : "▼ Sell"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>P&L Filter</label>
                <div className="flex gap-2">
                  {(["profit", "loss"] as const).map((mode) => (
                    <button key={mode} onClick={() => setFilters((f) => ({ ...f, pnl: f.pnl === mode ? "" : mode }))}
                      className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                      style={{
                        background: filters.pnl === mode ? (mode === "profit" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-bg)",
                        border: `1px solid ${filters.pnl === mode ? (mode === "profit" ? "var(--app-success)" : "var(--app-danger)") : "var(--app-border)"}`,
                        color: filters.pnl === mode ? "white" : "var(--app-muted-color)",
                      }}>
                      {mode === "profit" ? "✓ Profit" : "✗ Loss"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Trading Pair</label>
                <select value={filters.pair} onChange={(e) => setFilters((f) => ({ ...f, pair: e.target.value }))}
                  className="w-full py-3 px-3 rounded-xl text-sm font-medium outline-none"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-text)" }}>
                  <option value="">All Pairs</option>
                  {availablePairs.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Exact Date</label>
                <input type="date" value={filters.exactDate}
                  onChange={(e) => setFilters((f) => ({ ...f, exactDate: e.target.value }))}
                  className="w-full py-3 px-3 rounded-xl text-sm font-medium outline-none"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-text)" }}
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Min Rating</label>
                <div className="flex items-center gap-2">
                  {[1,2,3,4,5].map((star) => (
                    <button key={star} onClick={() => setFilters((f) => ({ ...f, rating: f.rating === star ? 0 : star }))}
                      style={{ color: star <= filters.rating ? "#EAB308" : "var(--app-border)" }}
                      className="transition-colors">
                      <Star size={28} fill={star <= filters.rating ? "currentColor" : "none"} strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setSearchQuery(""); setFilters({ direction: "", pair: "", rating: 0, startDate: "", endDate: "", exactDate: "", pnl: "" }); }}
                  className="flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
                >
                  Clear All
                </button>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
                >
                  Apply Filters
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Total P&L"
          value={currency(totalPnl)}
          isPositive={totalPnl >= 0}
          Icon={Activity}
          sparklineData={[10, 15, 8, 25, 18, 30, 24, totalPnl]}
        />
        <StatCard
          label="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          isPositive={winRate >= 50}
          Icon={Target}
          sparklineData={[45, 52, 48, 60, 58, winRate, 62, winRate]}
        />
        <StatCard
          label="Total Trades"
          value={String(filteredTrades.length)}
          isPositive={true}
          Icon={Users}
          sparklineData={[100, 105, 110, 115, 120, 125, 128, filteredTrades.length]}
        />
        <StatCard
          label="Profit Factor"
          value={profitFactor.toFixed(2)}
          isPositive={profitFactor >= 1.5}
          Icon={TrendingUp}
          sparklineData={[1.2, 1.4, 1.3, 1.6, 1.5, profitFactor, 1.7, profitFactor]}
        />
      </div>
      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Equity Curve card with Buy vs Sell indicators ─────── */}
        <div
          className="rounded-2xl overflow-hidden flex flex-col mt-[6px] mb-[6px]"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            backdropFilter: "blur(24px)",
          }}
        >
          {/* Card header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <p className="font-black text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
                Equity Curve
              </p>
              <p className="text-[10px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
                {totalTrades} trades · cumulative P&L
              </p>
            </div>
            <span
              className="text-xs font-black px-3 py-1.5 rounded-xl"
              style={{
                background: totalPnl >= 0 ? "rgba(0,200,151,0.12)" : "rgba(255,107,107,0.12)",
                color: totalPnl >= 0 ? "#00c897" : "#ff6b6b",
                border: `1px solid ${totalPnl >= 0 ? "rgba(0,200,151,0.28)" : "rgba(255,107,107,0.28)"}`,
              }}
            >
              {totalPnl >= 0 ? "+" : ""}{currency(totalPnl)}
            </span>
          </div>

          {/* ── Equity area chart ────────────────────────────── */}
          <div style={{ height: 180, paddingLeft: 8, paddingRight: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityChartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGradDash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8C52FF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#8C52FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="i" hide />
                <YAxis
                  tick={{ fontSize: 9, fill: chartColors.text }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDarkMode ? "rgba(13,22,50,0.95)" : "#fff",
                    border: "1px solid rgba(140,82,255,0.3)",
                    borderRadius: "12px",
                    fontSize: "11px",
                    color: chartColors.tooltipText,
                  }}
                  labelStyle={{ display: "none" }}
                  formatter={(v: any) => [currency(v), "Balance"]}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#8C52FF"
                  fill="url(#equityGradDash)"
                  strokeWidth={2}
                  dot={false}
                  style={{ filter: "drop-shadow(0 0 5px rgba(140,82,255,0.7))" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* ── Direction split bar ──────────────────────────── */}
          <div className="px-5 pt-3 pb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Direction Split
              </span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-[9px] font-bold" style={{ color: "var(--app-muted-color)" }}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#00c897" }} />
                  Buy {totalTrades > 0 ? ((buyTrades.length / totalTrades) * 100).toFixed(0) : 0}%
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-bold" style={{ color: "var(--app-muted-color)" }}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#ff6b6b" }} />
                  Sell {totalTrades > 0 ? ((sellTrades.length / totalTrades) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
            <div className="flex rounded-full overflow-hidden" style={{ height: 6, background: "rgba(255,255,255,0.06)" }}>
              {totalTrades > 0 && (
                <>
                  <div
                    style={{
                      width: `${(buyTrades.length / totalTrades) * 100}%`,
                      background: "linear-gradient(90deg, #00c897, #00c89770)",
                      transition: "width 0.5s ease",
                    }}
                  />
                  <div
                    style={{
                      width: `${(sellTrades.length / totalTrades) * 100}%`,
                      background: "linear-gradient(90deg, #ff6b6b70, #ff6b6b)",
                      transition: "width 0.5s ease",
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <PnLCalendar trades={filteredTrades} />
      </div>

      {/* ── Buying vs Selling Indicator ─────────────────────────────── */}
      {(() => {
        const buyAbs  = Math.abs(buyPnl);
        const sellAbs = Math.abs(sellPnl);
        const total   = buyAbs + sellAbs;
        const buyRatio  = total > 0 ? (buyAbs / total) * 100 : 50;
        const sellRatio = total > 0 ? (sellAbs / total) * 100 : 50;

        const buyDominant  = buyPnl > sellPnl;
        const sellDominant = sellPnl > buyPnl;
        const balanced     = buyPnl === sellPnl;

        const dominantLabel = balanced ? "Balanced" : buyDominant ? "Buy Dominant" : "Sell Dominant";
        const dominantColor = balanced ? "var(--app-muted-color)" : buyDominant ? "#00c897" : "#ff6b6b";
        const dominantBg    = balanced
          ? "rgba(255,255,255,0.05)"
          : buyDominant
            ? "rgba(0,200,151,0.10)"
            : "rgba(255,107,107,0.10)";
        const dominantBorder = balanced
          ? "rgba(255,255,255,0.12)"
          : buyDominant
            ? "rgba(0,200,151,0.25)"
            : "rgba(255,107,107,0.25)";

        return (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "var(--app-card)",
              border: "1px solid var(--app-border)",
              backdropFilter: "blur(24px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--app-border)" }}>
              <div>
                <p className="font-black text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
                  Buying vs Selling Indicator
                </p>
                <p className="text-[10px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
                  Net profit comparison · profit-based strength
                </p>
              </div>
              <span
                className="text-[10px] font-black px-3 py-1.5 rounded-xl"
                style={{ background: dominantBg, color: dominantColor, border: `1px solid ${dominantBorder}` }}
              >
                {dominantLabel}
              </span>
            </div>

            {/* Side-by-side stat cards */}
            <div className="grid grid-cols-2 gap-4 px-6 py-5">
              {/* Buy */}
              <div
                className="rounded-xl p-4"
                style={{ background: "rgba(0,200,151,0.06)", border: "1px solid rgba(0,200,151,0.18)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,151,0.14)" }}>
                    <TrendingUp size={13} color="#00c897" />
                  </span>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#00c897" }}>Long · Buy</p>
                    <p className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>{buyTrades.length} trades</p>
                  </div>
                  {buyDominant && (
                    <span className="ml-auto text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ background: "rgba(0,200,151,0.14)", color: "#00c897" }}>
                      Leader
                    </span>
                  )}
                </div>
                <p className="text-2xl font-black tracking-tight font-data tabular-nums mb-1" style={{ color: buyPnl >= 0 ? "#00c897" : "#ff6b6b" }}>
                  {buyPnl >= 0 ? "+" : ""}{currency(buyPnl)}
                </p>
                <div className="flex items-center justify-between mt-3 mb-1">
                  <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>Win Rate</span>
                  <span className="text-[10px] font-black" style={{ color: buyWinRate >= 50 ? "#00c897" : "#ff6b6b" }}>
                    {buyTrades.length > 0 ? `${buyWinRate.toFixed(0)}%` : "—"}
                  </span>
                </div>
                <div className="rounded-full overflow-hidden" style={{ height: 3, background: "rgba(0,200,151,0.12)" }}>
                  <div style={{ width: `${buyTrades.length > 0 ? buyWinRate : 0}%`, height: "100%", background: "#00c897", transition: "width 0.6s ease" }} />
                </div>
                <div className="mt-3 space-y-1.5 pt-3" style={{ borderTop: "1px solid rgba(0,200,151,0.12)" }}>
                  {[
                    { label: "Max Win",    val: dirAnalytics.buy.maxWin,        fmt: (v: number) => `+${currency(v)}`,   color: "#00c897" },
                    { label: "Max Loss",   val: dirAnalytics.buy.maxLoss,       fmt: (v: number) => currency(v),          color: "#ff6b6b" },
                    { label: "Avg Profit", val: dirAnalytics.buy.averageProfit, fmt: (v: number) => `+${currency(v)}`,   color: "#00c897" },
                    { label: "Avg RR",     val: dirAnalytics.buy.averageRR,     fmt: (v: number) => `${v.toFixed(2)}R`,  color: "var(--app-primary)" },
                  ].map(({ label, val, fmt, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>{label}</span>
                      <span className="text-[9px] font-black font-data tabular-nums" style={{ color: val !== null && val !== undefined ? color : "var(--app-muted-color)" }}>
                        {val !== null && val !== undefined ? fmt(val) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sell */}
              <div
                className="rounded-xl p-4"
                style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.18)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,107,107,0.14)" }}>
                    <TrendingDown size={13} color="#ff6b6b" />
                  </span>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#ff6b6b" }}>Short · Sell</p>
                    <p className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>{sellTrades.length} trades</p>
                  </div>
                  {sellDominant && (
                    <span className="ml-auto text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ background: "rgba(255,107,107,0.14)", color: "#ff6b6b" }}>
                      Leader
                    </span>
                  )}
                </div>
                <p className="text-2xl font-black tracking-tight font-data tabular-nums mb-1" style={{ color: sellPnl >= 0 ? "#00c897" : "#ff6b6b" }}>
                  {sellPnl >= 0 ? "+" : ""}{currency(sellPnl)}
                </p>
                <div className="flex items-center justify-between mt-3 mb-1">
                  <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>Win Rate</span>
                  <span className="text-[10px] font-black" style={{ color: sellWinRate >= 50 ? "#00c897" : "#ff6b6b" }}>
                    {sellTrades.length > 0 ? `${sellWinRate.toFixed(0)}%` : "—"}
                  </span>
                </div>
                <div className="rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,107,107,0.12)" }}>
                  <div style={{ width: `${sellTrades.length > 0 ? sellWinRate : 0}%`, height: "100%", background: "#ff6b6b", transition: "width 0.6s ease" }} />
                </div>
                <div className="mt-3 space-y-1.5 pt-3" style={{ borderTop: "1px solid rgba(255,107,107,0.12)" }}>
                  {[
                    { label: "Max Win",    val: dirAnalytics.sell.maxWin,        fmt: (v: number) => `+${currency(v)}`,  color: "#00c897" },
                    { label: "Max Loss",   val: dirAnalytics.sell.maxLoss,       fmt: (v: number) => currency(v),         color: "#ff6b6b" },
                    { label: "Avg Profit", val: dirAnalytics.sell.averageProfit, fmt: (v: number) => `+${currency(v)}`,  color: "#00c897" },
                    { label: "Avg RR",     val: dirAnalytics.sell.averageRR,     fmt: (v: number) => `${v.toFixed(2)}R`, color: "var(--app-primary)" },
                  ].map(({ label, val, fmt, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>{label}</span>
                      <span className="text-[9px] font-black font-data tabular-nums" style={{ color: val !== null && val !== undefined ? color : "var(--app-muted-color)" }}>
                        {val !== null && val !== undefined ? fmt(val) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Profit-strength split bar */}
            <div className="px-6 pb-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                    Profit Strength
                  </span>
                  <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>
                    — based on net P&L magnitude
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[9px] font-black" style={{ color: "#00c897" }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#00c897" }} />
                    Buy {buyRatio.toFixed(0)}%
                  </span>
                  <span className="flex items-center gap-1.5 text-[9px] font-black" style={{ color: "#ff6b6b" }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#ff6b6b" }} />
                    Sell {sellRatio.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* The split bar */}
              <div className="relative rounded-full overflow-hidden" style={{ height: 10, background: "rgba(255,255,255,0.05)", border: "1px solid var(--app-border)" }}>
                {total > 0 ? (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        height: "100%",
                        width: `${buyRatio}%`,
                        background: buyPnl >= 0
                          ? "linear-gradient(90deg, #00c897, #00c89790)"
                          : "linear-gradient(90deg, #ff6b6b, #ff6b6b80)",
                        transition: "width 0.7s cubic-bezier(0.4,0,0.2,1)",
                        borderRadius: "9999px 0 0 9999px",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        height: "100%",
                        width: `${sellRatio}%`,
                        background: sellPnl >= 0
                          ? "linear-gradient(90deg, #00c89790, #00c897)"
                          : "linear-gradient(90deg, #ff6b6b80, #ff6b6b)",
                        transition: "width 0.7s cubic-bezier(0.4,0,0.2,1)",
                        borderRadius: "0 9999px 9999px 0",
                      }}
                    />
                    {/* Center divider */}
                    <div
                      style={{
                        position: "absolute",
                        left: `${buyRatio}%`,
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 2,
                        height: 14,
                        background: "var(--app-bg)",
                        transition: "left 0.7s cubic-bezier(0.4,0,0.2,1)",
                        zIndex: 2,
                      }}
                    />
                  </>
                ) : (
                  <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.08)" }} />
                )}
              </div>

              {/* Labels under the bar */}
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[8px] font-bold" style={{ color: buyPnl >= 0 ? "rgba(0,200,151,0.6)" : "rgba(255,107,107,0.6)" }}>
                  {buyPnl >= 0 ? "Profitable" : "In drawdown"}
                </span>
                <span className="text-[8px] font-bold" style={{ color: sellPnl >= 0 ? "rgba(0,200,151,0.6)" : "rgba(255,107,107,0.6)" }}>
                  {sellPnl >= 0 ? "Profitable" : "In drawdown"}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recent Trades Table */}
      <div className="glass-card overflow-hidden">
        <div
          className="px-6 py-5 flex justify-between items-center"
          style={{ borderBottom: "1px solid var(--app-border)" }}
        >
          <div className="flex items-center gap-3">
            <h3 className="font-bold" style={{ color: "var(--app-text)" }}>
              Recent Journal Entries
            </h3>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest"
              style={{
                background: "color-mix(in srgb, var(--app-bg) 50%, transparent)",
                border: "1px solid var(--app-border)",
                color: "var(--app-muted-color)",
              }}
            >
              {filteredTrades.length} Total
            </span>
          </div>
        </div>
        {filteredTrades.length === 0 ? (
          <div className="px-6 py-20 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--app-primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)" }}>
              <Search size={28} style={{ color: "var(--app-primary)", opacity: 0.6 }} />
            </div>
            <div>
              <p className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>
                {searchQuery || filters.direction || filters.pair || filters.exactDate || filters.pnl || filters.startDate
                  ? "No journal entries found"
                  : "No trades yet"}
              </p>
              <p className="text-sm font-medium mt-1" style={{ color: "var(--app-muted-color)" }}>
                {searchQuery || filters.direction || filters.pair || filters.exactDate || filters.pnl || filters.startDate
                  ? "Try adjusting your filters or clearing the search"
                  : "Log your first trade to get started"}
              </p>
            </div>
            {(searchQuery || filters.direction || filters.pair || filters.exactDate || filters.pnl || filters.startDate) && (
              <button
                onClick={() => { setSearchQuery(""); setFilters({ direction: "", pair: "", rating: 0, startDate: "", endDate: "", exactDate: "", pnl: "" }); }}
                className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ background: "color-mix(in srgb, var(--app-bg) 50%, transparent)", borderBottom: "1px solid var(--app-border)" }}>
                  {["Name", "Pair", "Direction", "P&L", "Emotion", "Chart", "Rating", "Date", ""].map(
                    (h, i) => (
                      <th
                        key={i}
                        className="px-6 py-4 text-[10px] font-black uppercase tracking-widest"
                        style={{ color: "var(--app-muted-color)" }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredTrades
                  .slice(-20)
                  .reverse()
                  .map((trade) => (
                    <tr
                      key={trade.id}
                      className="transition-colors group"
                      style={{ borderBottom: "1px solid var(--app-border)" }}
                      data-testid={`row-trade-${trade.id}`}
                    >
                      <td className="px-6 py-5">
                        <p
                          className="font-bold text-sm tracking-tight"
                          style={{ color: "var(--app-text)" }}
                        >
                          {trade["Name"]}
                        </p>
                      </td>
                      <td className="px-6 py-5">
                        <span
                          className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-widest"
                          style={{
                            background: "var(--app-bg)",
                            border: "1px solid var(--app-border)",
                            color: "var(--app-muted-color)",
                          }}
                        >
                          {trade["Pairs"]}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-widest">
                          {trade["Direction"] === "Buy" ? (
                            <>
                              <TrendingUp size={12} style={{ color: "var(--app-success)" }} />
                              <span style={{ color: "var(--app-success)" }}>Buy</span>
                            </>
                          ) : (
                            <>
                              <TrendingDown size={12} style={{ color: "var(--app-danger)" }} />
                              <span style={{ color: "var(--app-danger)" }}>Sell</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td
                        className="px-6 py-5 font-black text-sm tracking-tight"
                        style={{
                          color:
                            numberValue(trade["Profit/Loss"]) >= 0
                              ? "var(--app-success)"
                              : "var(--app-danger)",
                        }}
                        data-testid={`text-pnl-${trade.id}`}
                      >
                        {currency(numberValue(trade["Profit/Loss"]))}
                      </td>
                      <td className="px-6 py-5">
                        <EmotionCell
                          tradeId={trade.id}
                          emotion={String(trade["Emotion"] || "")}
                        />
                      </td>
                      <td className="px-6 py-5">
                        {(() => {
                          const chartField = ["Entry", "Files & media", "entry"].find(
                            (f) => trade[f] && isValidTradingViewUrl(String(trade[f]))
                          );
                          if (!chartField) return <span style={{ color: "var(--app-muted-color)", fontSize: "12px" }}>—</span>;
                          return (
                            <TradingViewCard
                              url={String(trade[chartField])}
                              compact
                              onClick={() => setChartUrl(String(trade[chartField]))}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex gap-0.5" style={{ color: "#EAB308" }}>
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              size={14}
                              fill={
                                i < numberValue(trade["Rating(1-5)"])
                                  ? "currentColor"
                                  : "none"
                              }
                              strokeWidth={i < numberValue(trade["Rating(1-5)"]) ? 1 : 2}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <p
                          className="text-xs font-medium whitespace-nowrap"
                          style={{ color: "var(--app-muted-color)" }}
                        >
                          {trade["Date"]}
                        </p>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-1.5 md:opacity-0 md:group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => { if (!deletingTrade) setEditingTrade(trade); }}
                            disabled={!!deletingTrade}
                            className="p-2 rounded-xl transition-all"
                            style={{
                              background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                              color: "var(--app-primary)",
                              opacity: deletingTrade ? 0.4 : 1,
                            }}
                            title="Edit trade"
                            data-testid={`button-edit-${trade.id}`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => { if (!editingTrade) { setDeleteError(""); setDeletingTrade(trade); } }}
                            disabled={!!editingTrade}
                            className="p-2 rounded-xl transition-all"
                            style={{
                              background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)",
                              color: "var(--app-danger)",
                              opacity: editingTrade ? 0.4 : 1,
                            }}
                            title="Delete trade"
                            data-testid={`button-delete-${trade.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
