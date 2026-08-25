import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Target,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  Download,
} from "lucide-react";
import DayModal from "./DayModal";
import ExportModal from "./ExportModal";
import { useAccount } from "../context/AccountContext";

interface Trade {
  id: string;
  Date: string;
  "Profit/Loss": number;
  Name: string;
  Pairs: string;
  Direction: string;
  "Rating(1-5)": number;
  Session?: string;
  [key: string]: any;
}

interface PnLCalendarProps {
  trades: Trade[];
}

const LS_TARGET_KEY = "tradeEdge_dailyTarget";

function currency(value: number) {
  const isNegative = value < 0;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(value));
  return isNegative ? `-${formatted}` : formatted;
}

// ─── Filter bar ─────────────────────────────────────────────────────────────
interface Filters {
  pair: string;
  session: string;
  direction: string;
}

const EMPTY_FILTERS: Filters = { pair: "", session: "", direction: "" };

function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const active = value !== "";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest outline-none cursor-pointer transition-all"
        style={{
          background: active
            ? "color-mix(in srgb, var(--app-primary) 10%, transparent)"
            : "var(--app-bg)",
          border: `1px solid ${active ? "var(--app-primary)" : "var(--app-border)"}`,
          color: active ? "var(--app-primary)" : "var(--app-muted-color)",
        }}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={10}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: active ? "var(--app-primary)" : "var(--app-muted-color)" }}
      />
    </div>
  );
}

export default function PnLCalendar({ trades }: PnLCalendarProps) {
  const { selectedAccount } = useAccount();
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showExport, setShowExport] = useState(false);
  const [dailyTarget, setDailyTarget] = useState<number>(() => {
    try { return Number(localStorage.getItem(LS_TARGET_KEY)) || 0; } catch { return 0; }
  });
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  useEffect(() => {
    localStorage.setItem(LS_TARGET_KEY, String(dailyTarget));
  }, [dailyTarget]);

  const month = viewDate.getMonth();
  const year  = viewDate.getFullYear();
  // Dynamically compute days in this month (handles 28/29/30/31)
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  // ── Extract unique filter options from all trades ──────────────────────────
  const filterOptions = useMemo(() => {
    const pairs      = new Set<string>();
    const sessions   = new Set<string>();
    const directions = new Set<string>();
    trades.forEach((t) => {
      if (t.Pairs)     pairs.add(String(t.Pairs).trim());
      if (t.Session)   sessions.add(String(t.Session).trim());
      if (t.Direction) directions.add(String(t.Direction).trim());
    });
    return {
      pairs:      Array.from(pairs).sort(),
      sessions:   Array.from(sessions).sort(),
      directions: Array.from(directions).sort(),
    };
  }, [trades]);

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (filters.pair      && String(t.Pairs     || "").trim() !== filters.pair)      return false;
      if (filters.session   && String(t.Session   || "").trim() !== filters.session)   return false;
      if (filters.direction && String(t.Direction || "").trim() !== filters.direction) return false;
      return true;
    });
  }, [trades, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // ── Group filtered trades by date ──────────────────────────────────────────
  const dailyData = useMemo(() => {
    const data: Record<string, { pnl: number; trades: Trade[] }> = {};
    filteredTrades.forEach((trade) => {
      const dateStr = String(trade.Date || "").slice(0, 10);
      if (dateStr) {
        if (!data[dateStr]) data[dateStr] = { pnl: 0, trades: [] };
        data[dateStr].pnl += Number(trade["Profit/Loss"]) || 0;
        data[dateStr].trades.push(trade);
      }
    });
    return data;
  }, [filteredTrades]);

  const changeMonth = (offset: number) =>
    setViewDate(new Date(year, month + offset, 1));

  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const years = useMemo(() => {
    const cy = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => cy - 5 + i);
  }, []);

  // ── Month-level summary ────────────────────────────────────────────────────
  const monthTrades = filteredTrades.filter((t) => {
    const d = new Date(t.Date);
    return d.getMonth() === month && d.getFullYear() === year;
  });
  const monthTotal   = monthTrades.reduce((s, t) => s + (Number(t["Profit/Loss"]) || 0), 0);
  const monthWins    = monthTrades.filter((t) => (Number(t["Profit/Loss"]) || 0) > 0).length;
  const monthWinRate = monthTrades.length > 0 ? (monthWins / monthTrades.length) * 100 : 0;

  // Target days this month
  const targetDays  = dailyTarget > 0
    ? Object.values(dailyData).filter((d) => {
        const dateStr = Object.keys(dailyData).find((k) => dailyData[k] === d) || "";
        const dd = new Date(dateStr + "T12:00:00");
        return dd.getMonth() === month && dd.getFullYear() === year && d.pnl >= dailyTarget;
      }).length
    : 0;

  const selectedDayTrades = selectedDay ? (dailyData[selectedDay]?.trades ?? []) : [];

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function commitTarget() {
    const n = parseFloat(targetInput);
    if (!isNaN(n) && n >= 0) setDailyTarget(n);
    setEditingTarget(false);
    setTargetInput("");
  }

  return (
    <>
      <div
        className="rounded-3xl overflow-hidden"
        style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
      >
        {/* ── Header ── */}
        <div
          className="px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{
            borderBottom: "1px solid var(--app-border)",
            background: "color-mix(in srgb, var(--app-bg) 50%, transparent)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-xl"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                color: "var(--app-primary)",
              }}
            >
              <CalendarIcon size={20} />
            </div>
            <div>
              <h3 className="font-black text-lg tracking-tight" style={{ color: "var(--app-text)" }}>
                Performance Matrix
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Daily P&L Ledger — click any day for details
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Daily target toggle */}
            <button
              onClick={() => { setEditingTarget((v) => !v); setTargetInput(dailyTarget > 0 ? String(dailyTarget) : ""); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
              style={{
                background: dailyTarget > 0
                  ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
                  : "var(--app-bg)",
                border: `1px solid ${dailyTarget > 0 ? "var(--app-success)" : "var(--app-border)"}`,
                color: dailyTarget > 0 ? "var(--app-success)" : "var(--app-muted-color)",
              }}
              title="Set daily profit target"
            >
              <Target size={13} />
              {dailyTarget > 0 ? `Target $${dailyTarget}` : "Set Target"}
            </button>

            {/* Filters toggle */}
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
              style={{
                background: activeFilterCount > 0
                  ? "color-mix(in srgb, var(--app-primary) 10%, transparent)"
                  : "var(--app-bg)",
                border: `1px solid ${activeFilterCount > 0 ? "var(--app-primary)" : "var(--app-border)"}`,
                color: activeFilterCount > 0 ? "var(--app-primary)" : "var(--app-muted-color)",
              }}
            >
              <SlidersHorizontal size={13} />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              {filtersOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {/* Month nav */}
            <div
              className="flex rounded-xl p-1"
              style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
            >
              <button
                onClick={() => changeMonth(-1)}
                className="p-2 rounded-lg transition-colors"
                style={{ color: "var(--app-muted-color)" }}
                data-testid="calendar-prev-month"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-2 px-3" style={{ color: "var(--app-text)" }}>
                <select
                  value={month}
                  onChange={(e) => setViewDate(new Date(year, parseInt(e.target.value), 1))}
                  className="bg-transparent text-xs font-black uppercase tracking-widest outline-none cursor-pointer appearance-none pr-4"
                  data-testid="calendar-month-select"
                >
                  {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select
                  value={year}
                  onChange={(e) => setViewDate(new Date(parseInt(e.target.value), month, 1))}
                  className="bg-transparent text-xs font-black uppercase tracking-widest outline-none cursor-pointer appearance-none"
                  data-testid="calendar-year-select"
                >
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <button
                onClick={() => changeMonth(1)}
                className="p-2 rounded-lg transition-colors"
                style={{ color: "var(--app-muted-color)" }}
                data-testid="calendar-next-month"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Export button */}
            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                border: "1px solid var(--app-primary)",
                color: "var(--app-primary)",
              }}
              title="Export report as PNG or PDF"
            >
              <Download size={13} />
              Export
            </button>
          </div>
        </div>

        {/* ── Target input ── */}
        <AnimatePresence>
          {editingTarget && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className="px-6 py-4 flex items-center gap-3 flex-wrap"
                style={{ borderBottom: "1px solid var(--app-border)", background: "color-mix(in srgb, var(--app-success) 4%, transparent)" }}
              >
                <Target size={15} style={{ color: "var(--app-success)" }} />
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  Daily Profit Target ($)
                </span>
                <input
                  type="number"
                  min={0}
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitTarget()}
                  placeholder="e.g. 200"
                  autoFocus
                  className="w-32 px-3 py-1.5 rounded-xl text-sm font-bold outline-none"
                  style={{
                    background: "var(--app-bg)",
                    border: "1px solid var(--app-border)",
                    color: "var(--app-text)",
                  }}
                />
                <button
                  onClick={commitTarget}
                  className="px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest"
                  style={{ background: "var(--app-success)", color: "#fff" }}
                >
                  Save
                </button>
                {dailyTarget > 0 && (
                  <button
                    onClick={() => { setDailyTarget(0); setEditingTarget(false); }}
                    className="px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest"
                    style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Filters panel ── */}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className="px-6 py-4 flex items-center gap-3 flex-wrap"
                style={{ borderBottom: "1px solid var(--app-border)", background: "color-mix(in srgb, var(--app-bg) 60%, transparent)" }}
              >
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  Filter by:
                </span>
                <FilterChip
                  label="All Pairs"
                  value={filters.pair}
                  options={filterOptions.pairs}
                  onChange={(v) => updateFilter("pair", v)}
                />
                <FilterChip
                  label="All Sessions"
                  value={filters.session}
                  options={filterOptions.sessions}
                  onChange={(v) => updateFilter("session", v)}
                />
                <FilterChip
                  label="All Directions"
                  value={filters.direction}
                  options={filterOptions.directions}
                  onChange={(v) => updateFilter("direction", v)}
                />
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest"
                    style={{
                      background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)",
                      color: "var(--app-danger)",
                    }}
                  >
                    <X size={10} /> Clear all
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Quick stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderBottom: "1px solid var(--app-border)" }}>
          {[
            {
              label: "Monthly P&L",
              value: currency(monthTotal),
              color: monthTotal >= 0 ? "var(--app-success)" : "var(--app-danger)",
            },
            {
              label: "Win Rate",
              value: `${monthWinRate.toFixed(1)}%`,
              color: "var(--app-text)",
            },
            {
              label: "Entries",
              value: `${monthTrades.length} Trades`,
              color: "var(--app-text)",
            },
            {
              label: "Target Days",
              value: dailyTarget > 0 ? `${targetDays} / ${Object.keys(dailyData).filter((k) => { const d = new Date(k + "T12:00:00"); return d.getMonth() === month && d.getFullYear() === year; }).length}` : "—",
              color: dailyTarget > 0 ? "var(--app-success)" : "var(--app-muted-color)",
            },
          ].map(({ label, value, color }, i, arr) => (
            <div
              key={label}
              className="px-4 py-4 flex flex-col items-center justify-center"
              style={{ borderRight: i < arr.length - 1 ? "1px solid var(--app-border)" : "none" }}
            >
              <span className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
                {label}
              </span>
              <span className="text-sm font-black tracking-tight" style={{ color }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* ── Calendar grid — no overflow-hidden so all days are visible ── */}
        <div className="p-5 sm:p-7">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
              <div
                key={d}
                className="text-[10px] font-black uppercase tracking-widest text-center py-1"
                style={{ color: "color-mix(in srgb, var(--app-muted-color) 60%, transparent)" }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day cells — one grid for all rows, no clipping */}
          <div className="grid grid-cols-7 gap-1.5">
            {/* Leading blank cells */}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div
                key={`blank-${i}`}
                className="rounded-2xl"
                style={{
                  aspectRatio: "1",
                  background: "color-mix(in srgb, var(--app-bg) 30%, transparent)",
                }}
              />
            ))}

            {/* Actual day cells — rendered for every day (28–31) */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day     = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const data    = dailyData[dateStr];
              const pnl     = data?.pnl ?? null;
              const isToday = new Date().toISOString().slice(0, 10) === dateStr;
              const hasTrades = !!data && data.trades.length > 0;

              // Target indicator logic
              const targetMet    = dailyTarget > 0 && pnl !== null && pnl >= dailyTarget;
              const targetMissed = dailyTarget > 0 && pnl !== null && pnl < dailyTarget && hasTrades;

              return (
                <div
                  key={day}
                  onClick={() => hasTrades && setSelectedDay(dateStr)}
                  className="relative rounded-2xl transition-all duration-200 overflow-hidden group"
                  style={{
                    aspectRatio: "1",
                    background: pnl !== null && pnl > 0
                      ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
                      : pnl !== null && pnl < 0
                      ? "color-mix(in srgb, var(--app-danger) 10%, transparent)"
                      : "var(--app-card)",
                    border: `1px solid ${
                      targetMet    ? "var(--app-success)" :
                      targetMissed ? "var(--app-danger)"  :
                      pnl !== null && pnl > 0
                        ? "color-mix(in srgb, var(--app-success) 25%, transparent)"
                        : pnl !== null && pnl < 0
                        ? "color-mix(in srgb, var(--app-danger) 25%, transparent)"
                        : "var(--app-border)"
                    }`,
                    cursor: hasTrades ? "pointer" : "default",
                  }}
                  data-testid={`calendar-day-${dateStr}`}
                >
                  {/* Hover scale overlay */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"
                    style={{ background: "color-mix(in srgb, var(--app-text) 3%, transparent)" }}
                  />

                  <div className="absolute inset-0 p-1.5 flex flex-col justify-between">
                    {/* Top row: day number + trade count */}
                    <div className="flex items-start justify-between">
                      <span
                        className="text-[9px] font-black leading-none flex items-center justify-center"
                        style={{
                          width: isToday ? "16px" : "auto",
                          height: isToday ? "16px" : "auto",
                          background: isToday ? "var(--app-primary)" : "transparent",
                          color: isToday ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                          borderRadius: isToday ? "6px" : "0",
                        }}
                      >
                        {day}
                      </span>
                      {hasTrades && (
                        <span
                          className="text-[7px] font-black leading-none"
                          style={{ color: "var(--app-muted-color)" }}
                        >
                          {data.trades.length}T
                        </span>
                      )}
                    </div>

                    {/* Center: P&L amount */}
                    {pnl !== null && pnl !== 0 && (
                      <AnimatePresence>
                        <motion.span
                          initial={{ opacity: 0, y: 3 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-center text-[8px] font-black leading-none"
                          style={{ color: pnl >= 0 ? "var(--app-success)" : "var(--app-danger)" }}
                        >
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}
                        </motion.span>
                      </AnimatePresence>
                    )}

                    {/* Bottom: target indicator */}
                    {(targetMet || targetMissed) && (
                      <div className="flex justify-center">
                        <span className="text-[9px] leading-none" title={targetMet ? `Target $${dailyTarget} met!` : `Missed $${dailyTarget} target`}>
                          {targetMet ? "🎯" : "❌"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-5 flex-wrap">
            {[
              { color: "var(--app-success)", label: "Profit day" },
              { color: "var(--app-danger)",  label: "Loss day"   },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-md" style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, border: `1px solid ${color}` }} />
                <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>{label}</span>
              </div>
            ))}
            {dailyTarget > 0 && (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-[11px]">🎯</span>
                  <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>Target met (≥${dailyTarget})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px]">❌</span>
                  <span className="text-[10px] font-bold" style={{ color: "var(--app-muted-color)" }}>Target missed</span>
                </div>
              </>
            )}
            {activeFilterCount > 0 && (
              <span
                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                style={{
                  background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                  color: "var(--app-primary)",
                }}
              >
                {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Day modal */}
      {selectedDay && (
        <DayModal
          date={selectedDay}
          trades={selectedDayTrades}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {/* Export modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        month={month}
        year={year}
        dailyData={dailyData}
        monthTrades={monthTrades}
        selectedAccount={selectedAccount}
        selectedDay={selectedDay}
      />
    </>
  );
}
