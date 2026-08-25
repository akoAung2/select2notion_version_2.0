import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Newspaper, TrendingUp, TrendingDown, Minus, Clock, AlertTriangle,
  RefreshCw, Brain, Send, Globe, Activity, BarChart3, ChevronDown,
  ChevronUp, Zap, DollarSign, Shield, Filter, CheckSquare, Square,
  Sparkles, X, Loader2,
} from "lucide-react";
import { auth } from "../lib/firebase";

const API_BASE = "/api";

interface CalendarEvent {
  id: string;
  name: string;
  currency: string;
  impact: "high" | "medium" | "low";
  time: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  hasActual: boolean;
  isReleased: boolean;
  category: string;
}

interface AIReport {
  eventId: string;
  eventName: string;
  analysis: string;
  generatedAt: string;
  usdBias: "bullish" | "bearish" | "neutral";
  riskSentiment: string;
  affectedAssets?: Array<{
    asset: string;
    direction: "up" | "down" | "neutral";
    strength: string;
    reason: string;
  }>;
}

interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: { name: string };
  publishedAt: string;
  content?: string | null;
}

interface TelegramLog {
  id: string;
  type: "warning" | "release";
  eventName: string;
  message: string;
  sentAt: { _seconds: number } | string;
}

interface MacroBias {
  usdBias: "bullish" | "bearish" | "neutral";
  bullishSignals: number;
  bearishSignals: number;
  macroData: Record<string, { name: string; value: string; date: string }>;
  marketRates: Record<string, string | null>;
}

interface NewsSettings {
  telegram: { news_alert_timing: number[] };
  news_filters: { impact: string[]; currency: string[] };
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function useFetch<T>(url: string, interval = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}${url}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, interval);
    return () => clearInterval(t);
  }, [fetch_, interval]);

  return { data, loading, error, lastUpdated, refetch: fetch_ };
}

function ImpactBadge({ impact }: { impact: "high" | "medium" | "low" }) {
  const colors = {
    high: "bg-red-500/20 text-red-400 border-red-500/30",
    medium: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${colors[impact]}`}>
      {impact}
    </span>
  );
}

function BiasIndicator({ bias }: { bias: "bullish" | "bearish" | "neutral" }) {
  const config = {
    bullish: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "BULLISH" },
    bearish: { icon: TrendingDown, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "BEARISH" },
    neutral: { icon: Minus, color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", label: "NEUTRAL" },
  };
  const c = config[bias];
  return (
    <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-black border ${c.bg} ${c.border} ${c.color}`}>
      <c.icon size={14} />
      {c.label}
    </span>
  );
}

function Countdown({ targetTime }: { targetTime: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    function update() {
      const diff = new Date(targetTime).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Released"); return; }
      const h = Math.floor(diff / 3600_000);
      const m = Math.floor((diff % 3600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      if (h > 0) setTimeLeft(`${h}h ${m}m`);
      else if (m > 0) setTimeLeft(`${m}m ${s}s`);
      else setTimeLeft(`${s}s`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [targetTime]);
  return <span className="font-mono text-sm font-bold">{timeLeft}</span>;
}

// ── Ask AI Modal ────────────────────────────────────────────────────────────
function AskAIModal({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${API_BASE}/news/ask-ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            title: article.title,
            description: article.description,
            content: article.content,
            source: article.source.name,
            publishedAt: article.publishedAt,
            url: article.url,
          }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setAnalysis(data.analysis);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [article]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="w-full max-w-lg rounded-2xl border overflow-hidden shadow-2xl"
        style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--app-border)" }}>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl" style={{ background: "rgba(var(--app-primary-rgb),0.1)" }}>
              <Brain size={16} style={{ color: "var(--app-primary)" }} />
            </div>
            <div>
              <p className="font-black text-sm" style={{ color: "var(--app-text)" }}>AI News Analysis</p>
              <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>Gemini · Myanmar language</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl transition-all hover:bg-white/5"
            style={{ color: "var(--app-muted-color)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Article info */}
        <div className="px-5 py-3 border-b" style={{ borderColor: "var(--app-border)", background: "rgba(0,0,0,0.1)" }}>
          <p className="text-xs font-semibold leading-snug" style={{ color: "var(--app-text)" }}>
            {article.title}
          </p>
          <p className="text-[10px] mt-1 font-bold" style={{ color: "var(--app-primary)" }}>
            {article.source.name} · {new Date(article.publishedAt).toLocaleTimeString()}
          </p>
        </div>

        {/* Analysis output */}
        <div className="p-5 max-h-96 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--app-primary)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
                Analyzing with Gemini AI…
              </p>
            </div>
          )}
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
          {analysis && !loading && (
            <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans" style={{ color: "var(--app-text)" }}>
              {analysis}
            </pre>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Section 1: Macro Bias Card ─────────────────────────────────────────────
function MacroBiasCard({ data }: { data: MacroBias | null }) {
  if (!data) return <div className="animate-pulse h-48 rounded-2xl" style={{ background: "var(--app-card)" }} />;

  const marketPairs = [
    { label: "EUR/USD", key: "EURUSD" },
    { label: "GBP/USD", key: "GBPUSD" },
    { label: "USD/JPY", key: "USDJPY" },
    { label: "Gold", key: "XAUUSD" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 border"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl" style={{ background: "rgba(var(--app-primary-rgb),0.1)" }}>
            <Shield size={16} style={{ color: "var(--app-primary)" }} />
          </div>
          <div>
            <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>USD Macro Bias</h3>
            <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>Based on recent releases</p>
          </div>
        </div>
        <BiasIndicator bias={data.usdBias} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Bullish Signals</p>
          <p className="text-2xl font-black text-emerald-400">{data.bullishSignals}</p>
        </div>
        <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/15">
          <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Bearish Signals</p>
          <p className="text-2xl font-black text-red-400">{data.bearishSignals}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {marketPairs.map((p) => (
          <div key={p.key} className="text-center p-2 rounded-xl" style={{ background: "rgba(0,0,0,0.15)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--app-muted-color)" }}>{p.label}</p>
            <p className="text-xs font-black font-mono" style={{ color: "var(--app-text)" }}>
              {data.marketRates[p.key] ? Number(data.marketRates[p.key]).toFixed(p.key === "USDJPY" ? 3 : p.key === "XAUUSD" ? 2 : 5) : "—"}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Section 2: All Upcoming High-Impact Events ─────────────────────────────
function UpcomingHighImpactEvents({ events }: { events: CalendarEvent[] }) {
  const upcoming = events
    .filter((e) => e.impact === "high" && !e.isReleased && new Date(e.time).getTime() > Date.now())
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  if (upcoming.length === 0) {
    return (
      <div className="rounded-2xl p-5 border text-center" style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
        <Clock size={24} className="mx-auto mb-2" style={{ color: "var(--app-muted-color)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>No upcoming high-impact events</p>
      </div>
    );
  }

  const next = upcoming[0];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden relative"
      style={{ background: "var(--app-card)", borderColor: "rgba(239,68,68,0.3)" }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(239,68,68,0.04), transparent 70%)" }} />
      <div className="p-5 relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-xl bg-red-500/10">
            <Zap size={16} className="text-red-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Next High-Impact Event</p>
            <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>{next.name}</h3>
          </div>
          <ImpactBadge impact="high" />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--app-muted-color)" }}>Releases In</p>
            <div className="text-3xl font-black font-mono text-red-400"><Countdown targetTime={next.time} /></div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--app-muted-color)" }}>Forecast</p>
            <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>{next.forecast ?? "N/A"}</p>
            <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>Prev: {next.previous ?? "N/A"}</p>
          </div>
        </div>
      </div>
      {upcoming.slice(1).length > 0 && (
        <div className="border-t" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
          <p className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-wider text-red-400">
            {upcoming.slice(1).length} More High-Impact This Week
          </p>
          <div className="divide-y" style={{ borderColor: "rgba(239,68,68,0.1)" }}>
            {upcoming.slice(1, 6).map((e) => (
              <div key={e.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="text-[10px] font-mono font-bold w-14 flex-shrink-0 text-red-400">
                  {new Date(e.time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
                <span className="flex-1 text-[11px] font-semibold truncate" style={{ color: "var(--app-text)" }}>{e.name}</span>
                <Countdown targetTime={e.time} />
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Section 3: Economic Calendar ──────────────────────────────────────────
type ImpactFilter = "high" | "medium" | "low";

function EconomicCalendar({ events }: { events: CalendarEvent[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<ImpactFilter>>(new Set(["high", "medium", "low"]));
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleFilter = (f: ImpactFilter) => setActiveFilters((prev) => {
    const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next;
  });

  const today = events.filter((e) => {
    const d = new Date(e.time).toDateString();
    return d === new Date().toDateString() && activeFilters.has(e.impact);
  });

  const filterConfig: { key: ImpactFilter; label: string; color: string; activeBg: string }[] = [
    { key: "high", label: "High", color: "text-red-400", activeBg: "bg-red-500/15 border-red-500/30" },
    { key: "medium", label: "Medium", color: "text-orange-400", activeBg: "bg-orange-500/15 border-orange-500/30" },
    { key: "low", label: "Low", color: "text-slate-400", activeBg: "bg-slate-500/15 border-slate-500/30" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}
    >
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--app-border)" }}>
        <div className="flex items-center gap-2">
          <BarChart3 size={16} style={{ color: "var(--app-primary)" }} />
          <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Economic Calendar</h3>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: "rgba(var(--app-primary-rgb),0.1)", color: "var(--app-primary)" }}>
            {today.length} today
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1">
            {filterConfig.map((f) => (
              <button key={f.key} onClick={() => toggleFilter(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all ${activeFilters.has(f.key) ? f.activeBg : "border-transparent opacity-40"} ${f.color}`}>
                {activeFilters.has(f.key) ? <CheckSquare size={10} /> : <Square size={10} />}
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowFilterPanel(!showFilterPanel)}
            className="sm:hidden p-1.5 rounded-lg transition-all"
            style={{ background: "rgba(0,0,0,0.2)", color: "var(--app-muted-color)" }}>
            <Filter size={14} />
          </button>
          <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {showFilterPanel && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            className="overflow-hidden border-b" style={{ borderColor: "var(--app-border)" }}>
            <div className="px-5 py-3 flex gap-2">
              {filterConfig.map((f) => (
                <button key={f.key} onClick={() => toggleFilter(f.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all ${activeFilters.has(f.key) ? f.activeBg : "border-transparent opacity-40"} ${f.color}`}>
                  {activeFilters.has(f.key) ? <CheckSquare size={11} /> : <Square size={11} />}
                  {f.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="divide-y" style={{ borderColor: "var(--app-border)" }}>
        {today.length === 0 && (
          <div className="px-5 py-8 text-center" style={{ color: "var(--app-muted-color)" }}>
            <Globe size={24} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No events match current filter</p>
          </div>
        )}
        {today.map((event) => {
          const isExp = expanded.has(event.id);
          const rel = event.hasActual;
          const beat = rel && event.actual && event.forecast &&
            !isNaN(Number(event.actual.replace(/[^0-9.-]/g, ""))) &&
            Number(event.actual.replace(/[^0-9.-]/g, "")) > Number(event.forecast.replace(/[^0-9.-]/g, ""));
          return (
            <div key={event.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggle(event.id)}>
                <div className="text-[11px] font-mono font-bold w-12 flex-shrink-0" style={{ color: "var(--app-muted-color)" }}>
                  {new Date(event.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </div>
                <ImpactBadge impact={event.impact} />
                <span className="flex-1 text-sm font-semibold" style={{ color: "var(--app-text)" }}>{event.name}</span>
                <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                  {rel ? (
                    <span className={`font-black text-sm ${beat ? "text-emerald-400" : "text-red-400"}`}>{event.actual}</span>
                  ) : (
                    <span className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
                      <Countdown targetTime={event.time} />
                    </span>
                  )}
                  {isExp ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>
              <AnimatePresence>
                {isExp && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    className="mt-2 ml-16 grid grid-cols-3 gap-3">
                    {[
                      { label: "Actual", value: event.actual, color: rel ? (beat ? "text-emerald-400" : "text-red-400") : "text-slate-400" },
                      { label: "Forecast", value: event.forecast, color: "" },
                      { label: "Previous", value: event.previous, color: "" },
                    ].map((d) => (
                      <div key={d.label} className="p-2 rounded-xl" style={{ background: "rgba(0,0,0,0.15)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--app-muted-color)" }}>{d.label}</p>
                        <p className={`text-sm font-black ${d.color}`} style={!d.color ? { color: "var(--app-text)" } : undefined}>{d.value ?? "—"}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Section 4: Live News Releases ──────────────────────────────────────────
function LiveNewsReleases({ events }: { events: CalendarEvent[] }) {
  const released = events
    .filter((e) => e.hasActual)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
      <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--app-border)" }}>
        <Activity size={16} className="text-emerald-400" />
        <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Live Releases</h3>
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      </div>
      <div className="divide-y" style={{ borderColor: "var(--app-border)" }}>
        {released.length === 0 ? (
          <div className="px-5 py-6 text-center" style={{ color: "var(--app-muted-color)" }}>
            <Activity size={20} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No releases yet today</p>
          </div>
        ) : released.map((e) => {
          const beat = e.actual && e.forecast &&
            !isNaN(Number(e.actual.replace(/[^0-9.-]/g, ""))) &&
            Number(e.actual.replace(/[^0-9.-]/g, "")) > Number(e.forecast.replace(/[^0-9.-]/g, ""));
          return (
            <div key={e.id} className="px-5 py-3 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${beat ? "bg-emerald-400" : "bg-red-400"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--app-text)" }}>{e.name}</p>
                <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>
                  {new Date(e.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-black ${beat ? "text-emerald-400" : "text-red-400"}`}>{e.actual}</p>
                <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>vs {e.forecast ?? "—"}</p>
              </div>
              <ImpactBadge impact={e.impact} />
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Section 5: AI Analysis ─────────────────────────────────────────────────
function AIAnalysisCard({ reports }: { reports: AIReport[] }) {
  const [selected, setSelected] = useState(0);

  if (reports.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-6 border text-center"
        style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
        <Brain size={28} className="mx-auto mb-3 opacity-40" style={{ color: "var(--app-primary)" }} />
        <p className="font-bold text-sm" style={{ color: "var(--app-text)" }}>AI analysis will appear after events are released</p>
        <p className="text-xs mt-1" style={{ color: "var(--app-muted-color)" }}>Gemini analyzes each release automatically in Myanmar</p>
      </motion.div>
    );
  }

  const report = reports[selected];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--app-border)" }}>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl" style={{ background: "rgba(var(--app-primary-rgb),0.1)" }}>
            <Brain size={16} style={{ color: "var(--app-primary)" }} />
          </div>
          <div>
            <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>AI Fundamental Analysis</h3>
            <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>Gemini · Myanmar language</p>
          </div>
        </div>
        <BiasIndicator bias={report.usdBias} />
      </div>
      {reports.length > 1 && (
        <div className="flex overflow-x-auto gap-1 px-4 py-2 border-b" style={{ borderColor: "var(--app-border)" }}>
          {reports.slice(0, 5).map((r, i) => (
            <button key={r.eventId} onClick={() => setSelected(i)}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
              style={{ background: i === selected ? "var(--app-primary)" : "rgba(0,0,0,0.15)", color: i === selected ? "white" : "var(--app-muted-color)" }}>
              {r.eventName.split(" ").slice(0, 3).join(" ")}
            </button>
          ))}
        </div>
      )}
      <div className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--app-muted-color)" }}>
          {report.eventName} — {new Date(report.generatedAt).toLocaleTimeString()}
        </p>
        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans" style={{ color: "var(--app-text)" }}>
          {report.analysis}
        </pre>
      </div>
    </motion.div>
  );
}

// ── Section 6: Market Impact Matrix ───────────────────────────────────────
function MarketImpactMatrix({ reports }: { reports: AIReport[] }) {
  const latestReport = reports[0];
  const bias = latestReport?.usdBias ?? "neutral";
  const riskOn = latestReport?.riskSentiment === "risk_on";

  const assets = [
    { key: "USD", label: "US Dollar" },
    { key: "GOLD", label: "Gold / XAU" },
    { key: "SPX", label: "S&P 500" },
    { key: "NASDAQ", label: "NASDAQ" },
    { key: "EURUSD", label: "EUR/USD" },
    { key: "GBPUSD", label: "GBP/USD" },
    { key: "USDJPY", label: "USD/JPY" },
    { key: "BONDS", label: "US Bonds" },
  ] as const;

  // Build direction map from live rule-engine affectedAssets (per-event, actual AI pipeline output).
  // Falls back to derived formulas for any asset the rule engine didn't explicitly score.
  const affectedMap: Record<string, "bullish" | "bearish" | "neutral"> = {};
  if (latestReport?.affectedAssets?.length) {
    for (const a of latestReport.affectedAssets) {
      affectedMap[a.asset] =
        a.direction === "up" ? "bullish" : a.direction === "down" ? "bearish" : "neutral";
    }
  }

  const assetBias: Record<string, "bullish" | "bearish" | "neutral"> = {
    USD: affectedMap.USD ?? bias,
    GOLD: affectedMap.GOLD ?? (bias === "bullish" ? "bearish" : bias === "bearish" ? "bullish" : "neutral"),
    SPX: affectedMap.SPX ?? (riskOn ? "bullish" : latestReport ? "bearish" : "neutral"),
    NASDAQ: affectedMap.NASDAQ ?? (riskOn ? "bullish" : latestReport ? "bearish" : "neutral"),
    EURUSD: affectedMap.EURUSD ?? (bias === "bullish" ? "bearish" : bias === "bearish" ? "bullish" : "neutral"),
    GBPUSD: affectedMap.GBPUSD ?? (bias === "bullish" ? "bearish" : bias === "bearish" ? "bullish" : "neutral"),
    USDJPY: affectedMap.USDJPY ?? (bias === "bullish" ? "bullish" : bias === "bearish" ? "bearish" : "neutral"),
    BONDS: affectedMap.BONDS ?? (bias === "bullish" ? "bearish" : bias === "bearish" ? "bullish" : "neutral"),
  };

  // Source badge: indicates whether matrix is driven by live rule-engine data or derived fallback
  const isLiveData = latestReport?.affectedAssets?.length;
  const sourceLabel = isLiveData ? "Live Rule Engine" : latestReport ? "Derived" : null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
      <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--app-border)" }}>
        <Globe size={16} style={{ color: "var(--app-primary)" }} />
        <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Market Impact Matrix</h3>
        {!latestReport && <span className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>— awaiting releases</span>}
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {assets.map((a) => {
          const b = assetBias[a.key] ?? "neutral";
          const bgColor = b === "bullish" ? "bg-emerald-500/10 border-emerald-500/20" : b === "bearish" ? "bg-red-500/10 border-red-500/20" : "bg-slate-500/5 border-slate-500/15";
          const textColor = b === "bullish" ? "text-emerald-400" : b === "bearish" ? "text-red-400" : "text-slate-400";
          const Icon = b === "bullish" ? TrendingUp : b === "bearish" ? TrendingDown : Minus;
          return (
            <div key={a.key} className={`p-3 rounded-xl border ${bgColor}`}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--app-muted-color)" }}>{a.label}</p>
                <Icon size={14} className={textColor} />
              </div>
              <p className={`font-black text-sm ${textColor}`}>{b.toUpperCase()}</p>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Section 7: News Headlines with Ask AI ─────────────────────────────────
function NewsHeadlines({ forex, business }: { forex: NewsArticle[]; business: NewsArticle[] }) {
  const [tab, setTab] = useState<"forex" | "business">("business");
  const [askAIArticle, setAskAIArticle] = useState<NewsArticle | null>(null);
  const articles = tab === "forex" ? forex : business;

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--app-border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Newspaper size={16} style={{ color: "var(--app-primary)" }} />
            <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Market News</h3>
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          </div>
          <div className="flex gap-2">
            {(["forex", "business"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
                style={{ background: tab === t ? "var(--app-primary)" : "rgba(0,0,0,0.15)", color: tab === t ? "white" : "var(--app-muted-color)" }}>
                {t === "forex" ? `Forex (${forex.length})` : `Business (${business.length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: "var(--app-border)" }}>
          {articles.slice(0, 8).map((article, i) => (
            <div key={i} className="px-5 py-3 hover:bg-white/[0.02] transition-colors group">
              <div className="flex items-start gap-2">
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug group-hover:underline" style={{ color: "var(--app-text)" }}>
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold" style={{ color: "var(--app-primary)" }}>{article.source.name}</span>
                    <span className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>
                      {new Date(article.publishedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </a>
                {/* Ask AI Button */}
                <button
                  onClick={() => setAskAIArticle(article)}
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-black transition-all opacity-0 group-hover:opacity-100"
                  style={{ background: "rgba(var(--app-primary-rgb),0.15)", color: "var(--app-primary)", border: "1px solid rgba(var(--app-primary-rgb),0.2)" }}
                  title="Ask AI to analyze this article"
                >
                  <Sparkles size={10} />
                  Ask AI
                </button>
              </div>
            </div>
          ))}
          {articles.length === 0 && (
            <div className="px-5 py-6 text-center" style={{ color: "var(--app-muted-color)" }}>
              <p className="text-sm">No {tab} headlines available</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Ask AI Modal */}
      <AnimatePresence>
        {askAIArticle && (
          <AskAIModal article={askAIArticle} onClose={() => setAskAIArticle(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Section 8: Telegram Alert History ─────────────────────────────────────
function TelegramAlertHistory({ logs }: { logs: TelegramLog[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
      <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--app-border)" }}>
        <Send size={16} style={{ color: "var(--app-primary)" }} />
        <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Telegram Alert History</h3>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: "rgba(var(--app-primary-rgb),0.1)", color: "var(--app-primary)" }}>
          {logs.length}
        </span>
      </div>
      <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: "var(--app-border)" }}>
        {logs.length === 0 ? (
          <div className="px-5 py-6 text-center" style={{ color: "var(--app-muted-color)" }}>
            <Send size={20} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No alerts sent yet</p>
          </div>
        ) : logs.map((log) => {
          const ts = typeof log.sentAt === "string"
            ? new Date(log.sentAt)
            : new Date((log.sentAt as { _seconds: number })._seconds * 1000);
          const isWarning = log.type === "warning";
          return (
            <div key={log.id} className="px-5 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isWarning ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                  {isWarning ? "⚠ Warning" : "📊 Release"}
                </span>
                <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>{log.eventName}</span>
                <span className="ml-auto text-[10px]" style={{ color: "var(--app-muted-color)" }}>
                  {ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--app-muted-color)" }}>
                {log.message}
              </p>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── News Alert Settings Panel ──────────────────────────────────────────────
function NewsSettingsPanel() {
  const [settings, setSettings] = useState<NewsSettings>({
    telegram: { news_alert_timing: [60, 30, 15, 5, 1] },
    news_filters: { impact: ["HIGH", "MEDIUM", "LOW"], currency: ["USD", "EUR", "GBP", "JPY"] },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${API_BASE}/news/user-settings`, { headers });
        if (resp.ok) {
          const d = await resp.json();
          if (d.settings) setSettings(d.settings);
        }
      } catch { /* ignore */ }
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_BASE}/news/user-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const timingOptions = [60, 30, 15, 5, 1];
  const impactOptions = [
    { key: "HIGH", label: "High Impact", color: "text-red-400" },
    { key: "MEDIUM", label: "Medium Impact", color: "text-orange-400" },
    { key: "LOW", label: "Low Impact", color: "text-slate-400" },
  ];
  const currencyOptions = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];

  const toggleTiming = (m: number) => {
    const cur = settings.telegram.news_alert_timing;
    setSettings((s) => ({ ...s, telegram: { news_alert_timing: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a) } }));
  };
  const toggleImpact = (k: string) => {
    const cur = settings.news_filters.impact;
    setSettings((s) => ({ ...s, news_filters: { ...s.news_filters, impact: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] } }));
  };
  const toggleCurrency = (k: string) => {
    const cur = settings.news_filters.currency ?? [];
    setSettings((s) => ({ ...s, news_filters: { ...s.news_filters, currency: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] } }));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
      <button onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center gap-2 hover:bg-white/[0.02] transition-colors">
        <AlertTriangle size={16} style={{ color: "var(--app-primary)" }} />
        <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>Alert Preferences</h3>
        <span className="text-[10px] font-medium ml-2" style={{ color: "var(--app-muted-color)" }}>
          {settings.telegram.news_alert_timing.length} timings · {settings.news_filters.impact.length} impacts · {(settings.news_filters.currency ?? []).length} currencies
        </span>
        <div className="ml-auto">
          {open ? <ChevronUp size={14} style={{ color: "var(--app-muted-color)" }} /> : <ChevronDown size={14} style={{ color: "var(--app-muted-color)" }} />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-5 border-t" style={{ borderColor: "var(--app-border)" }}>

              {/* Warning Timing */}
              <div className="pt-4">
                <p className="text-[10px] font-black uppercase tracking-wider mb-3" style={{ color: "var(--app-muted-color)" }}>
                  Telegram Warning Timing
                </p>
                <div className="flex flex-wrap gap-2">
                  {timingOptions.map((m) => {
                    const active = settings.telegram.news_alert_timing.includes(m);
                    return (
                      <button key={m} onClick={() => toggleTiming(m)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition-all"
                        style={{ background: active ? "rgba(var(--app-primary-rgb),0.15)" : "rgba(0,0,0,0.15)", borderColor: active ? "rgba(var(--app-primary-rgb),0.4)" : "transparent", color: active ? "var(--app-primary)" : "var(--app-muted-color)", opacity: active ? 1 : 0.5 }}>
                        {active ? <CheckSquare size={11} /> : <Square size={11} />}
                        {m} min
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Impact Filter */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider mb-3" style={{ color: "var(--app-muted-color)" }}>
                  Impact Filter
                </p>
                <div className="flex flex-wrap gap-2">
                  {impactOptions.map(({ key, label, color }) => {
                    const active = settings.news_filters.impact.includes(key);
                    return (
                      <button key={key} onClick={() => toggleImpact(key)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition-all ${color}`}
                        style={{ background: active ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.05)", borderColor: active ? "currentColor" : "transparent", opacity: active ? 1 : 0.4 }}>
                        {active ? <CheckSquare size={11} /> : <Square size={11} />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Currency Filter */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider mb-3" style={{ color: "var(--app-muted-color)" }}>
                  Currency Filter (Telegram Alerts)
                </p>
                <div className="flex flex-wrap gap-2">
                  {currencyOptions.map((cur) => {
                    const active = (settings.news_filters.currency ?? []).includes(cur);
                    return (
                      <button key={cur} onClick={() => toggleCurrency(cur)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition-all"
                        style={{ background: active ? "rgba(var(--app-primary-rgb),0.12)" : "rgba(0,0,0,0.15)", borderColor: active ? "rgba(var(--app-primary-rgb),0.35)" : "transparent", color: active ? "var(--app-primary)" : "var(--app-muted-color)", opacity: active ? 1 : 0.4 }}>
                        {active ? <CheckSquare size={11} /> : <Square size={11} />}
                        {cur}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all"
                style={{ background: "var(--app-primary)", color: "white", opacity: saving ? 0.7 : 1 }}>
                {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Preferences"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────
export default function NewsDashboard() {
  const calendar = useFetch<{ ok: boolean; events: CalendarEvent[]; highImpact: CalendarEvent[] }>("/news/calendar", 30_000);
  const macro = useFetch<MacroBias & { ok: boolean }>("/news/macro-bias", 120_000);
  const aiReports = useFetch<{ ok: boolean; reports: AIReport[] }>("/news/ai-reports", 60_000);
  const telegramLogs = useFetch<{ ok: boolean; logs: TelegramLog[] }>("/news/telegram-logs", 30_000);
  const headlines = useFetch<{ ok: boolean; forex: NewsArticle[]; business: NewsArticle[] }>("/news/headlines", 120_000);

  const events = calendar.data?.events ?? [];
  const reports = aiReports.data?.reports ?? [];
  const logs = telegramLogs.data?.logs ?? [];
  const forexNews = headlines.data?.forex ?? [];
  const businessNews = headlines.data?.business ?? [];

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetch("/api/news/refresh", { method: "POST" }).catch(() => {});
    await Promise.all([calendar.refetch(), macro.refetch(), aiReports.refetch(), telegramLogs.refetch(), headlines.refetch()]);
    setIsRefreshing(false);
  };

  const anyLoading = calendar.loading && events.length === 0;
  const lastUpdate = calendar.lastUpdated;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
            News Intelligence
          </h2>
          <p className="font-medium text-sm mt-1" style={{ color: "var(--app-muted-color)" }}>
            Real-time economic calendar · AI fundamental analysis · Ask AI news · Telegram alerts
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-[11px] font-medium hidden lg:block" style={{ color: "var(--app-muted-color)" }}>
              Updated {lastUpdate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button onClick={handleRefresh} disabled={isRefreshing}
            className="p-2.5 rounded-xl transition-all"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
            <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {anyLoading && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-medium"
          style={{ background: "rgba(var(--app-primary-rgb),0.05)", border: "1px solid rgba(var(--app-primary-rgb),0.1)", color: "var(--app-primary)" }}>
          <RefreshCw size={16} className="animate-spin" />
          Loading economic intelligence data...
        </div>
      )}

      {/* Top row: Macro Bias + Next High Impact */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroBiasCard data={macro.data ?? null} />
        <UpcomingHighImpactEvents events={events} />
      </div>

      {/* Alert Preferences */}
      <NewsSettingsPanel />

      {/* Economic Calendar */}
      <EconomicCalendar events={events} />

      {/* Market Impact Matrix — full width with 8 assets */}
      <MarketImpactMatrix reports={reports} />

      {/* Releases + AI Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveNewsReleases events={events} />
        <AIAnalysisCard reports={reports} />
      </div>

      {/* News Headlines (with Ask AI) + Telegram */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NewsHeadlines forex={forexNews} business={businessNews} />
        <TelegramAlertHistory logs={logs} />
      </div>

      {/* FRED Macro Fundamentals */}
      {macro.data?.macroData && Object.keys(macro.data.macroData).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--app-card)", borderColor: "var(--app-border)" }}>
          <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--app-border)" }}>
            <Activity size={16} style={{ color: "var(--app-primary)" }} />
            <h3 className="font-black text-sm" style={{ color: "var(--app-text)" }}>US Macro Fundamentals</h3>
            <span className="text-[10px] font-bold text-blue-400">FRED — St. Louis Fed</span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(macro.data.macroData).map(([id, d]) => (
              <div key={id} className="p-3 rounded-xl" style={{ background: "rgba(0,0,0,0.15)" }}>
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--app-muted-color)" }}>{d.name}</p>
                <p className="text-base font-black font-mono" style={{ color: "var(--app-text)" }}>{d.value === "." ? "N/A" : d.value}</p>
                <p className="text-[9px]" style={{ color: "var(--app-muted-color)" }}>{d.date}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
