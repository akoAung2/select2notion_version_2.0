import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown, BarChart2, Award } from "lucide-react";

interface Trade {
  id: string;
  Date: string;
  "Profit/Loss": number;
  Name: string;
  Pairs: string;
  Direction: string;
  "Rating(1-5)": number;
  Session?: string;
  Emotion?: string;
  [key: string]: any;
}

interface DayModalProps {
  date: string;
  trades: Trade[];
  onClose: () => void;
}

function currency(value: number) {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(abs);
  return value < 0 ? `-${formatted}` : `+${formatted}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Award
          key={i}
          size={10}
          style={{ color: i < rating ? "var(--app-warning, #f59e0b)" : "var(--app-border)" }}
          fill={i < rating ? "var(--app-warning, #f59e0b)" : "transparent"}
        />
      ))}
    </div>
  );
}

export default function DayModal({ date, trades, onClose }: DayModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on backdrop click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  const netPnL = trades.reduce((sum, t) => sum + (Number(t["Profit/Loss"]) || 0), 0);
  // Count wins (P&L > 0) as TP hits, losses (P&L < 0) as SL hits
  const wins = trades.filter((t) => (Number(t["Profit/Loss"]) || 0) > 0);
  const losses = trades.filter((t) => (Number(t["Profit/Loss"]) || 0) < 0);
  const breakevens = trades.filter((t) => (Number(t["Profit/Loss"]) || 0) === 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const isProfit = netPnL >= 0;

  // Guard: document.body must exist (handles SSR / HMR edge cases)
  if (typeof document === "undefined" || !document.body) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        onClick={handleOverlayClick}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl overflow-hidden"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            boxShadow: "0 32px 64px rgba(0,0,0,0.25)",
          }}
        >
          {/* Header */}
          <div
            className="px-6 pt-6 pb-5 flex items-start justify-between shrink-0"
            style={{ borderBottom: "1px solid var(--app-border)" }}
          >
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
                Daily Breakdown
              </p>
              <h2 className="text-xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
                {formatDate(date)}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl transition-all mt-0.5 shrink-0"
              style={{ background: "var(--app-bg)", color: "var(--app-muted-color)", border: "1px solid var(--app-border)" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 shrink-0" style={{ borderBottom: "1px solid var(--app-border)" }}>
            {[
              {
                label: "Net P&L",
                value: currency(netPnL),
                color: isProfit ? "var(--app-success)" : "var(--app-danger)",
                icon: isProfit ? TrendingUp : TrendingDown,
              },
              { label: "Trades", value: String(trades.length), color: "var(--app-text)", icon: BarChart2 },
              {
                label: "TP Hits",
                value: String(wins.length),
                color: "var(--app-success)",
                icon: TrendingUp,
              },
              {
                label: "SL Hits",
                value: String(losses.length),
                color: losses.length > 0 ? "var(--app-danger)" : "var(--app-muted-color)",
                icon: TrendingDown,
              },
            ].map(({ label, value, color, icon: Icon }, i, arr) => (
              <div
                key={label}
                className="px-4 py-4 flex flex-col items-center gap-1"
                style={{ borderRight: i < arr.length - 1 ? "1px solid var(--app-border)" : "none" }}
              >
                <Icon size={14} style={{ color }} />
                <span className="text-base font-black tracking-tight" style={{ color }}>
                  {value}
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Win rate bar */}
          {trades.length > 0 && (
            <div className="px-6 py-3 shrink-0" style={{ borderBottom: "1px solid var(--app-border)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  Win Rate
                </span>
                <span className="text-[10px] font-black" style={{ color: "var(--app-text)" }}>
                  {winRate.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--app-border)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${winRate}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: "var(--app-success)" }}
                />
              </div>
            </div>
          )}

          {/* Trade list — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm" style={{ color: "var(--app-muted-color)" }}>
                No trades recorded for this day.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
                {trades.map((trade, idx) => {
                  const pnl = Number(trade["Profit/Loss"]) || 0;
                  const isWin = pnl > 0;
                  const isLoss = pnl < 0;
                  const rating = Number(trade["Rating(1-5)"]) || 0;

                  return (
                    <motion.li
                      key={trade.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.15 }}
                      className="px-6 py-4"
                    >
                      <div className="flex items-start gap-3">
                        {/* Indicator dot */}
                        <div
                          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{
                            background: isWin
                              ? "var(--app-success)"
                              : isLoss
                              ? "var(--app-danger)"
                              : "var(--app-muted-color)",
                          }}
                        />

                        <div className="flex-1 min-w-0">
                          {/* Top row: name + P&L */}
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-black truncate" style={{ color: "var(--app-text)" }}>
                              {trade.Name || trade.Pairs || "Unnamed Trade"}
                            </span>
                            <span
                              className="text-sm font-black shrink-0"
                              style={{ color: isWin ? "var(--app-success)" : isLoss ? "var(--app-danger)" : "var(--app-muted-color)" }}
                            >
                              {currency(pnl)}
                            </span>
                          </div>

                          {/* Detail chips */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {trade.Pairs && (
                              <span
                                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                                style={{ background: "var(--app-bg)", color: "var(--app-muted-color)", border: "1px solid var(--app-border)" }}
                              >
                                {trade.Pairs}
                              </span>
                            )}
                            {trade.Direction && (
                              <span
                                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                                style={{
                                  background: trade.Direction?.toLowerCase().includes("long") || trade.Direction?.toLowerCase().includes("buy")
                                    ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
                                    : "color-mix(in srgb, var(--app-danger) 10%, transparent)",
                                  color: trade.Direction?.toLowerCase().includes("long") || trade.Direction?.toLowerCase().includes("buy")
                                    ? "var(--app-success)"
                                    : "var(--app-danger)",
                                }}
                              >
                                {trade.Direction}
                              </span>
                            )}
                            {trade.Session && (
                              <span
                                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                                style={{ background: "var(--app-bg)", color: "var(--app-muted-color)", border: "1px solid var(--app-border)" }}
                              >
                                {trade.Session}
                              </span>
                            )}
                            {isWin && (
                              <span
                                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                                style={{ background: "color-mix(in srgb, var(--app-success) 10%, transparent)", color: "var(--app-success)" }}
                              >
                                TP ✓
                              </span>
                            )}
                            {isLoss && (
                              <span
                                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
                                style={{ background: "color-mix(in srgb, var(--app-danger) 10%, transparent)", color: "var(--app-danger)" }}
                              >
                                SL ✗
                              </span>
                            )}
                            {rating > 0 && <StarRating rating={rating} />}
                          </div>

                          {/* Emotion note if present */}
                          {trade.Emotion && (
                            <p className="mt-1.5 text-[11px] italic" style={{ color: "var(--app-muted-color)" }}>
                              "{trade.Emotion}"
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            )}

            {/* Breakeven note */}
            {breakevens.length > 0 && (
              <div className="px-6 py-3 text-center text-[11px]" style={{ color: "var(--app-muted-color)" }}>
                {breakevens.length} breakeven trade{breakevens.length > 1 ? "s" : ""} (P&L = $0)
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
