import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  X,
} from "lucide-react";
import { useGetNotionSchema } from "@workspace/api-client-react";
import TradeDetailModal from "./TradeDetailModal";
import { useAccount } from "../context/AccountContext";

const PAGE_SIZE = 20;

type SortDir = "asc" | "desc";

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

function formatCell(value: any, type: string): { text: string; pnl?: number } {
  if (value === null || value === undefined || value === "") return { text: "—" };
  if (type === "checkbox") return { text: value ? "✓" : "✗" };
  if (type === "number") {
    const n = Number(value);
    return { text: isNaN(n) ? "—" : n.toFixed(2), pnl: isNaN(n) ? undefined : n };
  }
  if (type === "date") {
    try { return { text: new Date(value).toLocaleDateString() }; } catch { return { text: String(value) }; }
  }
  if (type === "files") return { text: value ? "📎 Media" : "—" };
  if (type === "formula") return { text: typeof value === "object" ? JSON.stringify(value) : String(value) };
  return { text: String(value).slice(0, 60) };
}

const PRIORITY_COLS = ["Name", "Date", "Direction", "Pairs", "Session", "Profit/Loss", "Trading Account", "Account", "Rating(1-5)", "Emotion"];

export default function RecentTrades({ trades }: { trades: any[] }) {
  const { data: schemaData } = useGetNotionSchema();
  const schema = (schemaData?.schema ?? {}) as Record<string, any>;
  const { selectedAccount, accounts, accountColors, setSelectedAccount } = useAccount();

  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string>("Date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filterDir, setFilterDir] = useState("");

  const columns = useMemo<string[]>(() => {
    const schemaKeys = Object.keys(schema).filter(
      (k) => schema[k]?.type !== "formula"
    );
    const priority = PRIORITY_COLS.filter((k) => schemaKeys.includes(k));
    const rest = schemaKeys.filter((k) => !PRIORITY_COLS.includes(k));
    return [...priority, ...rest].slice(0, 12);
  }, [schema]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        Object.values(t).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    if (filterDir) {
      list = list.filter((t) => String(t.Direction ?? "").toLowerCase() === filterDir.toLowerCase());
    }
    if (sortCol) {
      list.sort((a, b) => {
        const va = a[sortCol] ?? "";
        const vb = b[sortCol] ?? "";
        if (sortCol === "Date") {
          const da = new Date(va).getTime() || 0;
          const db = new Date(vb).getTime() || 0;
          return sortDir === "asc" ? da - db : db - da;
        }
        const na = Number(va);
        const nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) {
          return sortDir === "asc" ? na - nb : nb - na;
        }
        return sortDir === "asc"
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }
    return list;
  }, [trades, search, sortCol, sortDir, filterDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const pnlKey = columns.find((c) => c === "Profit/Loss" || c === "PnL" || c === "P&L");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
            Recent Trades
          </h2>
          <p className="font-medium text-sm mt-1" style={{ color: "var(--app-muted-color)" }}>
            {filtered.length} trade{filtered.length !== 1 ? "s" : ""} — click any row to view details
          </p>
        </div>

        {/* Account filter pills */}
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setSelectedAccount(null); setPage(1); }}
              className="px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              style={{
                background: !selectedAccount
                  ? "var(--app-primary)"
                  : "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                color: !selectedAccount ? "var(--app-primary-fg)" : "var(--app-primary)",
                border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
              }}
            >
              All
            </button>
            {accounts.map((a) => (
              <button
                key={a}
                onClick={() => { setSelectedAccount(a); setPage(1); }}
                className="px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                style={{
                  background: selectedAccount === a
                    ? accountColors[a]
                    : "color-mix(in srgb, var(--app-primary) 5%, transparent)",
                  color: selectedAccount === a ? "#fff" : "var(--app-text)",
                  border: `1px solid ${selectedAccount === a ? accountColors[a] : "var(--app-border)"}`,
                }}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-muted-color)" }} />
          <input
            type="text"
            className="input-field pl-10 text-sm"
            placeholder="Search trades..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
              <X size={14} style={{ color: "var(--app-muted-color)" }} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{
              background: showFilter || filterDir
                ? "color-mix(in srgb, var(--app-primary) 10%, transparent)"
                : "var(--app-card)",
              border: `1px solid ${showFilter || filterDir ? "color-mix(in srgb, var(--app-primary) 20%, transparent)" : "var(--app-border)"}`,
              color: showFilter || filterDir ? "var(--app-primary)" : "var(--app-muted-color)",
            }}
          >
            <Filter size={14} /> Filters {filterDir && `(1)`}
          </button>
          {filterDir && (
            <button
              onClick={() => { setFilterDir(""); setPage(1); }}
              className="px-3 py-2.5 rounded-xl text-xs font-bold"
              style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilter && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="flex flex-wrap gap-4 p-5 rounded-2xl"
              style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
            >
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--app-muted-color)" }}>Direction</p>
                <div className="flex gap-2">
                  {["Buy", "Sell"].map((d) => (
                    <button
                      key={d}
                      onClick={() => { setFilterDir(filterDir === d ? "" : d); setPage(1); }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: filterDir === d
                          ? d === "Buy" ? "color-mix(in srgb, var(--app-success) 15%, transparent)" : "color-mix(in srgb, var(--app-danger) 15%, transparent)"
                          : "var(--app-bg)",
                        color: filterDir === d
                          ? d === "Buy" ? "var(--app-success)" : "var(--app-danger)"
                          : "var(--app-muted-color)",
                        border: `1px solid ${filterDir === d
                          ? d === "Buy" ? "color-mix(in srgb, var(--app-success) 25%, transparent)" : "color-mix(in srgb, var(--app-danger) 25%, transparent)"
                          : "var(--app-border)"}`,
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid var(--app-border)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: "var(--app-card)", borderBottom: "1px solid var(--app-border)" }}>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort(col)}
                    style={{ color: "var(--app-muted-color)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase tracking-widest">{col}</span>
                      {sortCol === col ? (
                        sortDir === "asc" ? <ArrowUp size={11} style={{ color: "var(--app-primary)" }} /> : <ArrowDown size={11} style={{ color: "var(--app-primary)" }} />
                      ) : (
                        <ArrowUpDown size={11} className="opacity-30" />
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3" style={{ color: "var(--app-muted-color)" }}>
                  <span className="text-[9px] font-black uppercase tracking-widest">View</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="text-center py-12" style={{ color: "var(--app-muted-color)" }}>
                    No trades found
                  </td>
                </tr>
              ) : (
                pageData.map((trade, idx) => {
                  const tradePnl = getPnL(trade);
                  const isPos = tradePnl > 0;
                  const isNeg = tradePnl < 0;
                  return (
                    <motion.tr
                      key={trade.id ?? idx}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => setDetail(trade)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderBottom: "1px solid var(--app-border)",
                        background: "transparent",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--app-primary) 3%, transparent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {columns.map((col) => {
                        const prop = schema[col];
                        const { text, pnl: cellPnl } = formatCell(trade[col], prop?.type ?? "rich_text");
                        const isPnlCol = cellPnl !== undefined && (col === "Profit/Loss" || col === "PnL" || col === "P&L");
                        const dirCol = col === "Direction";
                        return (
                          <td key={col} className="px-4 py-3 whitespace-nowrap">
                            {text === "—" ? (
                              <span style={{ color: "var(--app-muted-color)" }}>—</span>
                            ) : isPnlCol ? (
                              <span
                                className="px-2 py-0.5 rounded-lg text-xs font-black"
                                style={{
                                  background: isPos
                                    ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
                                    : isNeg
                                    ? "color-mix(in srgb, var(--app-danger) 12%, transparent)"
                                    : "var(--app-bg)",
                                  color: isPos ? "var(--app-success)" : isNeg ? "var(--app-danger)" : "var(--app-muted-color)",
                                }}
                              >
                                {isPos ? "+" : ""}{text}
                              </span>
                            ) : dirCol ? (
                              <span
                                className="px-2 py-0.5 rounded-lg text-xs font-black uppercase"
                                style={{
                                  background: String(trade[col] ?? "").toLowerCase().includes("buy")
                                    ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
                                    : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
                                  color: String(trade[col] ?? "").toLowerCase().includes("buy") ? "var(--app-success)" : "var(--app-danger)",
                                }}
                              >
                                {text}
                              </span>
                            ) : (
                              <span style={{ color: "var(--app-text)" }}>{text}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetail(trade); }}
                          className="p-1.5 rounded-xl transition-all"
                          style={{
                            background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                            color: "var(--app-primary)",
                          }}
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderTop: "1px solid var(--app-border)", background: "var(--app-card)" }}
          >
            <span className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
              Page {page} of {totalPages} — {filtered.length} total
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-xl transition-all disabled:opacity-30"
                style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.min(Math.max(page - 2, 1) + i, totalPages);
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className="w-8 h-8 rounded-xl text-xs font-black transition-all"
                    style={{
                      background: p === page ? "var(--app-primary)" : "var(--app-bg)",
                      color: p === page ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                      border: `1px solid ${p === page ? "var(--app-primary)" : "var(--app-border)"}`,
                    }}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-xl transition-all disabled:opacity-30"
                style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trade detail modal */}
      {detail && (
        <TradeDetailModal
          trade={detail}
          schema={schema}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
