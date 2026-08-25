import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Loader2, CheckCircle2 } from "lucide-react";
import { exportMonthlyReport, exportDailyReport, type ReportTrade, type DayData } from "../lib/reportExporter";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  month: number;
  year: number;
  dailyData: Record<string, DayData>;
  monthTrades: ReportTrade[];
  selectedAccount: string | null;
  selectedDay?: string | null;
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export default function ExportModal({
  isOpen, onClose,
  month, year, dailyData, monthTrades, selectedAccount, selectedDay,
}: ExportModalProps) {
  const [theme,  setTheme]  = useState<"light" | "dark">("dark");
  const [format, setFormat] = useState<"png" | "pdf">("png");
  const [type,   setType]   = useState<"monthly" | "daily">("monthly");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  // Build list of days that have trades in this month (for daily picker)
  const tradeDays = useMemo(() => {
    return Object.entries(dailyData)
      .filter(([ds]) => {
        const d = new Date(ds + "T12:00:00");
        return d.getMonth() === month && d.getFullYear() === year;
      })
      .map(([ds]) => ds)
      .sort();
  }, [dailyData, month, year]);

  const defaultDay = useMemo(() => {
    if (selectedDay && tradeDays.includes(selectedDay)) return selectedDay;
    return tradeDays[tradeDays.length - 1] ?? null;
  }, [selectedDay, tradeDays]);

  const [pickedDay, setPickedDay] = useState<string | null>(defaultDay);

  // Update pickedDay when defaultDay changes
  useMemo(() => { setPickedDay(defaultDay); }, [defaultDay]);

  async function generate() {
    setStatus("loading");
    try {
      if (type === "monthly") {
        await exportMonthlyReport({ format, theme, month, year, monthTrades, dailyData, selectedAccount });
      } else {
        const date = pickedDay ?? defaultDay;
        if (!date) {
          alert("No trade day available to export.");
          setStatus("idle");
          return;
        }
        const dayTrades = dailyData[date]?.trades ?? [];
        await exportDailyReport({ format, theme, date, dayTrades, selectedAccount });
      }
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      console.error("[ExportModal] Export failed:", err);
      setStatus("idle");
      alert("Export failed. Please try again.");
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#00000000]"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl bg-[#0d1632]"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
          >
            {/* Header */}
            <div
              className="px-6 py-5 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--app-border)", background: "color-mix(in srgb, var(--app-bg) 50%, transparent)" }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--app-primary) 12%, transparent)", color: "var(--app-primary)" }}>
                  <Download size={18} />
                </div>
                <div>
                  <h3 className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>Export Report</h3>
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                    {MONTH_NAMES[month]} {year}{selectedAccount ? ` · ${selectedAccount}` : ""}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:opacity-70" style={{ color: "var(--app-muted-color)" }}>
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-5">

              {/* Report Type */}
              <OptionGroup label="Report Type">
                <RadioBtn active={type === "monthly"} onClick={() => setType("monthly")}>
                  Monthly Report
                  <span className="text-[10px] ml-1 opacity-60">· {MONTH_NAMES[month]} {year}</span>
                </RadioBtn>
                <RadioBtn active={type === "daily"} onClick={() => setType("daily")}>
                  Daily Report
                  {tradeDays.length === 0 && <span className="text-[10px] ml-1 opacity-50">· no trades</span>}
                </RadioBtn>
              </OptionGroup>

              {/* Day picker (only when daily is selected) */}
              <AnimatePresence>
                {type === "daily" && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                        Select Date
                      </span>
                      {tradeDays.length === 0 ? (
                        <p className="text-sm" style={{ color: "var(--app-muted-color)" }}>No trade days found in {MONTH_NAMES[month]}.</p>
                      ) : (
                        <select
                          value={pickedDay ?? ""}
                          onChange={(e) => setPickedDay(e.target.value)}
                          className="px-3 py-2 rounded-xl text-sm font-semibold outline-none cursor-pointer"
                          style={{
                            background: "var(--app-bg)",
                            border: "1px solid var(--app-border)",
                            color: "var(--app-text)",
                          }}
                        >
                          {tradeDays.map((ds) => {
                            const d = new Date(ds + "T12:00:00");
                            const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                            const entry = dailyData[ds];
                            const sign = entry.pnl >= 0 ? "+" : "";
                            return (
                              <option key={ds} value={ds}>
                                {label}  {sign}${Math.abs(entry.pnl).toFixed(2)}  ({entry.trades.length}T)
                              </option>
                            );
                          })}
                        </select>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Theme */}
              <OptionGroup label="Theme">
                <RadioBtn active={theme === "light"} onClick={() => setTheme("light")}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full border border-gray-300 bg-white" />
                    Light
                  </span>
                </RadioBtn>
                <RadioBtn active={theme === "dark"} onClick={() => setTheme("dark")}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-slate-800" />
                    Dark
                  </span>
                </RadioBtn>
              </OptionGroup>

              {/* Format */}
              <OptionGroup label="Format">
                <RadioBtn active={format === "png"} onClick={() => setFormat("png")}>
                  PNG Image
                  <span className="text-[10px] ml-1 opacity-60">· {type === "monthly" ? "1200×1600" : "1200×1200"}</span>
                </RadioBtn>
                <RadioBtn active={format === "pdf"} onClick={() => setFormat("pdf")}>
                  PDF
                  <span className="text-[10px] ml-1 opacity-60">· single page</span>
                </RadioBtn>
              </OptionGroup>

              {/* Summary */}
              <div
                className="px-4 py-3 rounded-2xl text-xs font-semibold"
                style={{ background: "color-mix(in srgb, var(--app-primary) 8%, transparent)", color: "var(--app-muted-color)", border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)" }}
              >
                {type === "monthly" ? (
                  <>
                    {monthTrades.length} trades · {MONTH_NAMES[month]} {year}
                    {selectedAccount && <> · {selectedAccount}</>}
                  </>
                ) : (
                  <>
                    {pickedDay
                      ? `${dailyData[pickedDay]?.trades.length ?? 0} trades · ${new Date(pickedDay + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                      : "No day selected"}
                    {selectedAccount && <> · {selectedAccount}</>}
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5">
              <button
                onClick={generate}
                disabled={status === "loading" || (type === "daily" && !pickedDay)}
                className="w-full py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{
                  background: status === "done"
                    ? "var(--app-success)"
                    : "var(--app-primary)",
                  color: "#FFFFFF",
                }}
              >
                {status === "loading" && <Loader2 size={16} className="animate-spin" />}
                {status === "done"    && <CheckCircle2 size={16} />}
                {status === "idle"    && <Download size={16} />}
                {status === "loading" ? "Generating…"
                  : status === "done" ? "Downloaded!"
                  : "Generate Report"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
        {label}
      </span>
      <div className="flex gap-2 flex-wrap">
        {children}
      </div>
    </div>
  );
}

function RadioBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
      style={{
        background: active
          ? "color-mix(in srgb, var(--app-primary) 12%, transparent)"
          : "var(--app-bg)",
        border: `1.5px solid ${active ? "var(--app-primary)" : "var(--app-border)"}`,
        color: active ? "var(--app-primary)" : "var(--app-muted-color)",
      }}
    >
      <span
        className="inline-block w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
        style={{
          borderColor: active ? "var(--app-primary)" : "var(--app-border)",
          background: active ? "var(--app-primary)" : "transparent",
        }}
      />
      {children}
    </button>
  );
}
