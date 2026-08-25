import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Edit3,
  Trash2,
  Save,
  ChevronDown,
  PlusSquare,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Link2,
  CheckCircle,
} from "lucide-react";
import { useUpdateTrade, useDeleteTrade, getGetTradesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TradingViewCard, isValidTradingViewUrl, isValidUrl } from "./TradingViewPreview";

interface TradeDetailModalProps {
  trade: any;
  schema: Record<string, any>;
  onClose: () => void;
}

function formatPropertyValue(key: string, value: any, type: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "checkbox") return value ? "Yes" : "No";
  if (type === "number") return typeof value === "number" ? value.toFixed(2) : String(value);
  if (type === "date") return value ? new Date(value).toLocaleDateString() : "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function getPnL(trade: any): number {
  const keys = ["Profit/Loss", "PnL", "P&L", "pnl", "profit", "Profit", "loss"];
  for (const k of keys) {
    if (trade[k] !== undefined && trade[k] !== null && trade[k] !== "") {
      const n = Number(trade[k]);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function extractMediaUrls(raw: any): string[] {
  if (!raw) return [];
  const str = String(raw);
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

function PropertyBadge({ value, type }: { value: string; type: string }) {
  const isPositive = type === "number" && parseFloat(value) > 0;
  const isNegative = type === "number" && parseFloat(value) < 0;
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-xl text-xs font-bold"
      style={{
        background: isPositive
          ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
          : isNegative
          ? "color-mix(in srgb, var(--app-danger) 12%, transparent)"
          : "color-mix(in srgb, var(--app-primary) 8%, transparent)",
        color: isPositive
          ? "var(--app-success)"
          : isNegative
          ? "var(--app-danger)"
          : "var(--app-primary)",
        border: `1px solid ${
          isPositive
            ? "color-mix(in srgb, var(--app-success) 20%, transparent)"
            : isNegative
            ? "color-mix(in srgb, var(--app-danger) 20%, transparent)"
            : "color-mix(in srgb, var(--app-primary) 15%, transparent)"
        }`,
      }}
    >
      {value}
    </span>
  );
}

export default function TradeDetailModal({ trade, schema, onClose }: TradeDetailModalProps) {
  const qClient = useQueryClient();
  const updateTrade = useUpdateTrade();
  const deleteTrade = useDeleteTrade();

  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");

  useEffect(() => {
    if (trade) {
      const initial: Record<string, any> = {};
      Object.keys(schema).forEach((key) => {
        initial[key] = trade[key] ?? "";
      });
      setEditForm(initial);
    }
  }, [trade, schema]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pnl = getPnL(trade);
  const pnlPositive = pnl > 0;

  const orderedKeys = Object.keys(schema).filter((k) => schema[k].type !== "formula");

  function updateEditField(key: string, value: any) {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaveStatus("saving");
    const payload: Record<string, any> = { ...editForm };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "" || payload[k] === null || payload[k] === undefined) {
        delete payload[k];
      }
    });
    updateTrade.mutate(
      { id: trade.id, data: payload },
      {
        onSuccess: () => {
          setSaveStatus("success");
          qClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
          setTimeout(() => {
            setSaveStatus("idle");
            setMode("view");
          }, 1200);
        },
        onError: () => {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 2500);
        },
      }
    );
  }

  async function handleDelete() {
    deleteTrade.mutate(
      { id: trade.id },
      {
        onSuccess: () => {
          qClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
          onClose();
        },
      }
    );
  }

  const mediaUrls = extractMediaUrls(trade?.["Files & media"] ?? trade?.files ?? "");

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center md:p-4"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", damping: 30, stiffness: 320 }}
          className="relative w-full md:max-w-4xl flex flex-col overflow-hidden shadow-2xl ml-[14px] mr-[14px] mt-[45px] mb-[45px] rounded-bl-[24px] rounded-br-[24px]"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            borderRadius: "1.5rem 1.5rem 0 0",
            maxHeight: "92dvh",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-3 pb-1 md:hidden flex-shrink-0">
            <div className="w-10 h-1 rounded-full" style={{ background: "var(--app-border)" }} />
          </div>

          {/* Header */}
          <div className="flex-shrink-0 px-5 md:px-8 pt-3 md:pt-5 pb-4 md:pb-5" style={{ borderBottom: "1px solid var(--app-border)" }}>
            {/* Title row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base md:text-xl font-black tracking-tight leading-tight" style={{ color: "var(--app-text)" }}>
                    {trade?.Name ?? trade?.name ?? "Trade Details"}
                  </h2>
                  {pnl !== 0 && (
                    <span
                      className="px-2 py-0.5 rounded-lg text-xs font-black flex-shrink-0"
                      style={{
                        background: pnlPositive
                          ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
                          : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
                        color: pnlPositive ? "var(--app-success)" : "var(--app-danger)",
                      }}
                    >
                      {pnlPositive ? "+" : ""}{pnl.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] mt-0.5 font-medium" style={{ color: "var(--app-muted-color)" }}>
                  {trade?.Date ? new Date(trade.Date).toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : ""}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl transition-all flex-shrink-0 mt-0.5"
                style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Action buttons row */}
            {mode === "view" && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => setMode("edit")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                    color: "var(--app-primary)",
                  }}
                >
                  <Edit3 size={13} /> Edit
                </button>
                <button
                  onClick={() => setMode("delete")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)",
                    color: "var(--app-danger)",
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
            {mode === "edit" && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleSave}
                  disabled={saveStatus === "saving"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: "color-mix(in srgb, var(--app-success) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--app-success) 20%, transparent)",
                    color: "var(--app-success)",
                  }}
                >
                  {saveStatus === "saving" ? <Loader2 size={13} className="animate-spin" /> : saveStatus === "success" ? <CheckCircle size={13} /> : <Save size={13} />}
                  {saveStatus === "saving" ? "Saving…" : saveStatus === "success" ? "Saved!" : "Save"}
                </button>
                <button
                  onClick={() => { setMode("view"); setSaveStatus("idle"); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Delete confirmation */}
          <AnimatePresence>
            {mode === "delete" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden flex-shrink-0"
              >
                <div
                  className="px-5 md:px-8 py-3 md:py-4"
                  style={{
                    background: "color-mix(in srgb, var(--app-danger) 6%, transparent)",
                    borderBottom: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={15} style={{ color: "var(--app-danger)", flexShrink: 0 }} />
                    <p className="text-xs font-bold leading-snug" style={{ color: "var(--app-danger)" }}>
                      Permanently delete this trade from Notion?
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleteTrade.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition-all"
                      style={{ background: "var(--app-danger)", color: "#fff" }}
                    >
                      {deleteTrade.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Delete
                    </button>
                    <button
                      onClick={() => setMode("view")}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Body */}
          <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>

            {/* Properties grid */}
            <div className="px-5 md:px-8 py-5 md:py-6">
              {mode === "view" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
                  {orderedKeys.map((key) => {
                    const prop = schema[key];
                    if (!prop) return null;
                    const rawVal = trade[key];

                    /* Files/URLs — render as TradingView cards or clickable links */
                    if (prop.type === "files") {
                      const links = extractMediaUrls(rawVal);
                      const tvLinks = links.filter(isValidTradingViewUrl);
                      const plainLinks = links.filter(u => !isValidTradingViewUrl(u));
                      if (links.length === 0) return null;
                      return (
                        <div key={key} className="flex flex-col gap-2 md:col-span-2">
                          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                            {key} ({links.length})
                          </span>
                          {tvLinks.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {tvLinks.map((url, i) => <TradingViewCard key={i} url={url} />)}
                            </div>
                          )}
                          {plainLinks.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              {plainLinks.map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium"
                                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-primary)" }}
                                >
                                  <Link2 size={12} className="flex-shrink-0" />
                                  <span className="flex-1 truncate">{url}</span>
                                  <ExternalLink size={11} className="flex-shrink-0 opacity-60" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }

                    const displayVal = formatPropertyValue(key, rawVal, prop.type);
                    return (
                      <div key={key} className="flex flex-col gap-1.5">
                        <span
                          className="text-[9px] font-black uppercase tracking-widest"
                          style={{ color: "var(--app-muted-color)" }}
                        >
                          {key}
                        </span>
                        {displayVal === "—" ? (
                          <span className="text-sm" style={{ color: "var(--app-muted-color)" }}>—</span>
                        ) : (
                          <PropertyBadge value={displayVal} type={prop.type} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Edit mode */
                (<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {orderedKeys.map((key) => {
                    const prop = schema[key];
                    if (!prop) return null;

                    const label = (
                      <label className="text-[9px] font-black uppercase tracking-widest mb-1.5 block" style={{ color: "var(--app-muted-color)" }}>
                        {key}
                      </label>
                    );

                    /* Files/URLs — editable list of up to 5 links with validation */
                    if (prop.type === "files") {
                      const links: string[] = editForm[key]
                        ? String(editForm[key]).split(",").map((s: string) => s.trim()).filter(Boolean)
                        : [];
                      const setLinks = (next: string[]) => updateEditField(key, next.join(","));
                      return (
                        <div key={key} className="md:col-span-2">
                          {label}
                          <div className="space-y-2 mb-2 max-h-52 overflow-y-auto">
                            {links.map((url, i) => {
                              const valid = url.trim() ? isValidUrl(url.trim()) : null;
                              return (
                                <div key={i} className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest w-10 shrink-0" style={{ color: "var(--app-muted-color)" }}>
                                      URL {i + 1}
                                    </span>
                                    <div className="relative flex-1 min-w-0">
                                      <input
                                        type="url"
                                        className="input-field pr-8 text-xs w-full"
                                        value={url}
                                        onChange={(e) => {
                                          const next = [...links];
                                          next[i] = e.target.value;
                                          setLinks(next);
                                        }}
                                        placeholder="https://..."
                                      />
                                      {url && (
                                        <button
                                          type="button"
                                          className="absolute right-2 top-1/2 -translate-y-1/2"
                                          onClick={() => {
                                            const next = links.filter((_, j) => j !== i);
                                            setLinks(next.length === 0 ? [] : next);
                                          }}
                                          style={{ color: "var(--app-muted-color)" }}
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      )}
                                    </div>
                                    {url && (
                                      <span
                                        className="text-[9px] font-black px-2 py-0.5 rounded-full shrink-0"
                                        style={{
                                          background: valid ? "color-mix(in srgb, var(--app-success) 12%, transparent)" : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
                                          color: valid ? "var(--app-success)" : "var(--app-danger)",
                                        }}
                                      >
                                        {valid ? "✓" : "✗"}
                                      </span>
                                    )}
                                  </div>
                                  {url && !valid && (
                                    <div className="ml-12 flex items-center gap-1 text-[10px]" style={{ color: "var(--app-danger)" }}>
                                      <AlertCircle size={10} /> Must start with https://
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {links.length < 5 && (
                            <button
                              type="button"
                              onClick={() => setLinks([...links, ""])}
                              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl w-full justify-center"
                              style={{
                                background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                                border: "1px dashed color-mix(in srgb, var(--app-primary) 25%, transparent)",
                                color: "var(--app-primary)",
                              }}
                            >
                              <PlusSquare size={12} /> Add Link ({links.length}/5)
                            </button>
                          )}
                        </div>
                      );
                    }

                    if (prop.type === "title" || prop.type === "rich_text") {
                      return (
                        <div key={key}>
                          {label}
                          <input
                            type="text"
                            className="input-field text-sm"
                            value={editForm[key] || ""}
                            onChange={(e) => updateEditField(key, e.target.value)}
                            placeholder={`Enter ${key}...`}
                          />
                        </div>
                      );
                    }
                    if (prop.type === "select") {
                      return (
                        <div key={key}>
                          {label}
                          <div className="relative">
                            <select
                              className="input-field appearance-none pr-8 text-sm"
                              value={editForm[key] || ""}
                              onChange={(e) => updateEditField(key, e.target.value)}
                            >
                              <option value="">Select {key}...</option>
                              {prop.select?.options?.map((opt: any) => (
                                <option key={opt.id} value={opt.name}>{opt.name}</option>
                              ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-muted-color)" }} />
                          </div>
                        </div>
                      );
                    }
                    if (prop.type === "multi_select") {
                      const current: string[] = editForm[key]
                        ? String(editForm[key]).split(",").map((s: string) => s.trim()).filter(Boolean)
                        : [];
                      return (
                        <div key={key}>
                          {label}
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {current.map((v) => (
                              <span key={v} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold"
                                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                                {v}
                                <button type="button" onClick={() => updateEditField(key, current.filter(x => x !== v).join(", "))}><X size={9} /></button>
                              </span>
                            ))}
                          </div>
                          <div className="relative">
                            <select
                              className="input-field appearance-none pr-8 text-sm"
                              value=""
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val && !current.includes(val)) updateEditField(key, [...current, val].join(", "));
                              }}
                            >
                              <option value="">Add {key}...</option>
                              {prop.multi_select?.options?.map((opt: any) => (
                                <option key={opt.id} value={opt.name}>{opt.name}</option>
                              ))}
                            </select>
                            <PlusSquare size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--app-muted-color)" }} />
                          </div>
                        </div>
                      );
                    }
                    if (prop.type === "date") {
                      return (
                        <div key={key}>
                          {label}
                          <input type="date" className="input-field text-sm" value={editForm[key] || ""} onChange={(e) => updateEditField(key, e.target.value)} />
                        </div>
                      );
                    }
                    if (prop.type === "number") {
                      return (
                        <div key={key}>
                          {label}
                          <input type="number" step="any" className="input-field text-sm" value={editForm[key] || ""} onChange={(e) => updateEditField(key, e.target.value)} placeholder="0.00" />
                        </div>
                      );
                    }
                    if (prop.type === "checkbox") {
                      const checked = !!editForm[key];
                      return (
                        <div key={key} className="flex items-center gap-3">
                          {label}
                          <button
                            type="button"
                            onClick={() => updateEditField(key, !checked)}
                            className="w-10 h-5 rounded-full relative transition-colors flex-shrink-0"
                            style={{ background: checked ? "var(--app-primary)" : "var(--app-border)" }}
                          >
                            <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all shadow-sm" style={{ background: "#fff", left: checked ? "1.25rem" : "0.125rem" }} />
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>)
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
