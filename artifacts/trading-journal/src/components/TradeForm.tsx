import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Star, ChevronDown, PlusSquare, Activity, AlertCircle, Settings2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { TradingViewCard, isValidTradingViewUrl, isValidUrl } from "./TradingViewPreview";
import OptionManagerModal from "./OptionManagerModal";
import {
  useGetNotionSchema,
  useCreateTrade,
  getGetTradesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function numberValue(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupFields(schema: Record<string, any>) {
  const priority = ["Name", "Date", "Direction", "Pairs", "Session", "Entry Window (New York Time)", "Profit/Loss", "Rating(1-5)", "Emotion", "Negative tags", "entry", "reversal /condi", "Followed rules", "Lq taken", "DOW", "Month", "Year", "Files & media"];
  const formula = [] as string[];
  const ordered: string[] = [];
  const seen = new Set<string>();

  priority.forEach((k) => {
    if (schema[k] && schema[k].type !== "formula") {
      ordered.push(k);
      seen.add(k);
    }
  });

  Object.keys(schema).forEach((k) => {
    if (!seen.has(k)) {
      if (schema[k].type === "formula") formula.push(k);
      else { ordered.push(k); seen.add(k); }
    }
  });

  const groups: Array<{ title: string; fields: string[] }> = [
    { title: "Trade Details", fields: ordered.slice(0, Math.ceil(ordered.length / 2)) },
    { title: "Psychology & Notes", fields: ordered.slice(Math.ceil(ordered.length / 2)) },
  ];
  return groups.filter((g) => g.fields.length > 0);
}

interface TradeFormProps {
  onTradeCreated?: () => void;
}

export default function TradeForm({ onTradeCreated }: TradeFormProps) {
  const queryClient = useQueryClient();
  const { data: schemaData, isLoading: isLoadingSchema } = useGetNotionSchema();
  const schema = schemaData?.schema as Record<string, any> | undefined;

  const [form, setForm] = useState<Record<string, any>>({});
  const [status, setStatus] = useState({ type: "", message: "" });
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [tvErrors, setTvErrors] = useState<Record<string, string>>({});
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string[]>>({});
  const [optionManager, setOptionManager] = useState<{ propertyName: string; propertyType: "select" | "multi_select" | "status"; options: Array<{ id: string; name: string }> } | null>(null);

  const createTrade = useCreateTrade();

  useEffect(() => {
    if (schema && Object.keys(form).length === 0) {
      const initial: Record<string, any> = {};
      const today = new Date().toISOString().split("T")[0];
      Object.entries(schema).forEach(([key, prop]: [string, any]) => {
        if (key === "Date") initial[key] = today;
        else if (prop.type === "number") initial[key] = "";
        else if (prop.type === "checkbox") initial[key] = false;
        else if (prop.type === "select") initial[key] = prop.select?.options?.[0]?.name || "";
        else initial[key] = "";
      });
      setForm(initial);
    }
  }, [schema]);

  const groups = useMemo(() => {
    if (!schema) return [];
    return groupFields(schema);
  }, [schema]);

  function updateField(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ type: "", message: "" });

    const payload: Record<string, any> = { ...form };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "" || payload[k] === null || payload[k] === undefined) {
        delete payload[k];
      }
    });

    createTrade.mutate(
      { data: payload },
      {
        onSuccess: () => {
          setStatus({ type: "success", message: "Trade logged to Notion successfully!" });
          setForm({});
          setTvErrors({});
          queryClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
          onTradeCreated?.();
          setTimeout(() => setStatus({ type: "", message: "" }), 4000);
        },
        onError: (err: any) => {
          setStatus({
            type: "error",
            message: err?.message || "Failed to create trade. Check your Notion credentials.",
          });
        },
      }
    );
  }

  if (isLoadingSchema) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 rounded-2xl animate-pulse"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
          />
        ))}
      </div>
    );
  }

  if (!schema) {
    return (
      <div
        className="glass-card p-12 text-center"
        style={{ borderColor: "var(--app-border)" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "color-mix(in srgb, var(--app-danger) 10%, transparent)" }}
        >
          <X size={28} style={{ color: "var(--app-danger)" }} />
        </div>
        <h3 className="font-black text-xl mb-2" style={{ color: "var(--app-text)" }}>
          Notion Not Connected
        </h3>
        <p className="text-sm" style={{ color: "var(--app-muted-color)" }}>
          Please add your NOTION_KEY and NOTION_DB_ID to the Replit Secrets panel, then restart the server.
        </p>
      </div>
    );
  }

  return (
    <section
      className="rounded-3xl overflow-hidden"
      style={{
        background: "var(--app-card)",
        border: "1px solid var(--app-border)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset, 0 24px 64px rgba(0,0,0,0.25)",
      }}
    >
      {/* Header gradient accent bar */}
      <div
        className="h-0.5 w-full"
        style={{
          background: "linear-gradient(90deg, var(--app-primary), var(--app-secondary), transparent)",
        }}
      />
      <div className="p-8 mt-[3px] mb-[3px] ml-[-6px] mr-[-6px] pl-[29px] pr-[29px] bg-[#00000012]">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-1.5 h-5 rounded-full"
            style={{
              background: "linear-gradient(180deg, var(--app-primary), var(--app-secondary))",
              boxShadow: "0 0 10px rgba(var(--app-primary-rgb),0.5)",
            }}
          />
          <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--app-primary)" }}>
            Trade Entry
          </span>
        </div>
        <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
          Log New Trade
        </h2>
        <p className="text-sm font-medium mt-1" style={{ color: "var(--app-muted-color)" }}>
          Document your setup, psychology, and outcome.
        </p>
      </div>
      {status.message && (
        <div
          className="mb-6 flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-medium"
          style={{
            background: status.type === "success"
              ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
              : "color-mix(in srgb, var(--app-danger) 10%, transparent)",
            border: `1px solid color-mix(in srgb, ${status.type === "success" ? "var(--app-success)" : "var(--app-danger)"} 20%, transparent)`,
            color: status.type === "success" ? "var(--app-success)" : "var(--app-danger)",
          }}
        >
          {status.message}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-[#00000000]">
          {groups.map((group) => (
            <div
              key={group.title}
              className="rounded-2xl space-y-5 overflow-hidden pl-[0px] pr-[0px] pt-[0px] pb-[0px] opacity-[0.9] text-left font-bold text-[10px] mt-[-3px] mb-[-3px] ml-[0px] mr-[0px] text-foreground rounded-tl-[7px] rounded-tr-[7px] rounded-br-[7px] rounded-bl-[7px] bg-[#ffffff00]"
              style={{
                background: "rgba(var(--app-primary-rgb), 0.025)",
                border: "1px solid var(--app-border)",
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.05) inset",
              }}
            >
              {/* Group header */}
              <div
                className="flex items-center gap-3 px-6 pt-5 pb-4"
                style={{ borderBottom: "1px solid var(--app-border)" }}
              >
                <div
                  className="w-1 h-4 rounded-full flex-shrink-0"
                  style={{
                    background: "linear-gradient(180deg, var(--app-primary), var(--app-secondary))",
                    boxShadow: "0 0 8px rgba(var(--app-primary-rgb),0.5)",
                  }}
                />
                <h3
                  className="text-[9px] font-black uppercase tracking-[0.2em] text-[#725ee3]"
                  style={{ color: "var(--app-muted-color)" }}
                >
                  {group.title}
                </h3>
              </div>
              <div className="px-6 pb-6 space-y-5 text-sm text-foreground">

              {group.fields.map((key) => {
                const prop = schema[key];
                if (!prop) return null;
                const isFocused = focusedField === key;

                const label = (
                  <label
                    className="text-[10px] uppercase tracking-widest mb-2 block font-bold text-card-foreground"
                    style={{ color: "var(--app-muted-color)" }}
                  >
                    {key}
                  </label>
                );

                if (prop.type === "title" || prop.type === "rich_text") {
                  return (
                    <div key={key}>
                      {label}
                      <input
                        type="text"
                        className="input-field ml-[0px] mr-[0px] opacity-[1] border-t-[color:var(--app-muted-color)] border-r-[color:var(--app-muted-color)] border-b-[color:var(--app-muted-color)] border-l-[color:var(--app-muted-color)]"
                        value={form[key] || ""}
                        onChange={(e) => updateField(key, e.target.value)}
                        onFocus={() => setFocusedField(key)}
                        onBlur={() => setFocusedField(null)}
                        placeholder={`Enter ${key}...`}
                        style={isFocused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}}
                        data-testid={`input-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      />
                    </div>
                  );
                }

                if (prop.type === "select") {
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-2 text-card-foreground">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#3f7fe1]" style={{ color: "var(--app-muted-color)" }}>{key}</label>
                        <button type="button" onClick={() => setOptionManager({ propertyName: key, propertyType: "select", options: prop.select?.options || [] })}
                          className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all text-foreground"
                          style={{ color: "var(--app-muted-color)", background: "transparent" }}>
                          <Settings2 size={10} /> Manage
                        </button>
                      </div>
                      <div className="relative">
                        <select
                          className="input-field appearance-none pr-10 border-t-[#8c52ff0d] border-r-[#8c52ff0d] border-b-[#8c52ff0d] border-l-[#8c52ff0d] opacity-[0.85]"
                          value={form[key] || ""}
                          onChange={(e) => updateField(key, e.target.value)}
                          onFocus={() => setFocusedField(key)}
                          onBlur={() => setFocusedField(null)}
                          data-testid={`select-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                        >
                          <option value="">Select {key}...</option>
                          {prop.select?.options?.map((opt: any) => (
                            <option key={opt.id} value={opt.name}>{opt.name}</option>
                          ))}
                        </select>
                        <ChevronDown
                          size={16}
                          className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ color: isFocused ? "var(--app-primary)" : "var(--app-muted-color)" }}
                        />
                      </div>
                    </div>
                  );
                }

                if (prop.type === "multi_select") {
                  const currentValues: string[] = form[key]
                    ? String(form[key]).split(",").map((s: string) => s.trim()).filter(Boolean)
                    : [];
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#3a74cf]" style={{ color: "var(--app-muted-color)" }}>{key}</label>
                        <button type="button" onClick={() => setOptionManager({ propertyName: key, propertyType: "multi_select", options: prop.multi_select?.options || [] })}
                          className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all text-foreground"
                          style={{ color: "var(--app-muted-color)", background: "transparent" }}>
                          <Settings2 size={10} /> Manage
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 mb-2">
                          {currentValues.map((v) => (
                            <span
                              key={v}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest"
                              style={{
                                background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                                color: "var(--app-primary)",
                                border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                              }}
                            >
                              {v}
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = currentValues.filter((x) => x !== v);
                                  updateField(key, updated.join(", "));
                                }}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="relative">
                          <select
                            className="input-field appearance-none pr-10"
                            value=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val && !currentValues.includes(val)) {
                                updateField(key, [...currentValues, val].join(", "));
                              }
                            }}
                            onFocus={() => setFocusedField(key)}
                            onBlur={() => setFocusedField(null)}
                            data-testid={`multiselect-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                          >
                            <option value="">Add {key}...</option>
                            {prop.multi_select?.options?.map((opt: any) => (
                              <option key={opt.id} value={opt.name}>{opt.name}</option>
                            ))}
                          </select>
                          <PlusSquare
                            size={16}
                            className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                            style={{ color: isFocused ? "var(--app-primary)" : "var(--app-muted-color)" }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                if (prop.type === "date") {
                  return (
                    <div key={key}>
                      {label}
                      <input
                        type="date"
                        className="input-field border-t-[color:var(--app-muted-color)] border-r-[color:var(--app-muted-color)] border-b-[color:var(--app-muted-color)] border-l-[color:var(--app-muted-color)]"
                        value={form[key] || ""}
                        onChange={(e) => updateField(key, e.target.value)}
                        onFocus={() => setFocusedField(key)}
                        onBlur={() => setFocusedField(null)}
                        data-testid={`input-date-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      />
                    </div>
                  );
                }

                if (prop.type === "number") {
                  return (
                    <div key={key}>
                      {label}
                      <div className="relative">
                        <input
                          type="number"
                          step="any"
                          className="input-field pr-16 border-t-[color:var(--app-muted-color)] border-r-[color:var(--app-muted-color)] border-b-[color:var(--app-muted-color)] border-l-[color:var(--app-muted-color)]"
                          value={form[key] || ""}
                          onChange={(e) => updateField(key, e.target.value)}
                          onFocus={() => setFocusedField(key)}
                          onBlur={() => setFocusedField(null)}
                          placeholder="0.00"
                          data-testid={`input-number-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                        />
                        <span
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-foreground"
                          style={{ color: "var(--app-muted-color)" }}
                        >
                          Value
                        </span>
                      </div>
                    </div>
                  );
                }

                if (prop.type === "files") {
                  const urls: string[] = urlDrafts[key] ?? (() => {
                    const rawVal = String(form[key] || "");
                    return rawVal ? rawVal.split(",").map((s) => s.trim()).filter(Boolean) : [""];
                  })();

                  const setUrls = (newUrls: string[]) => {
                    setUrlDrafts((prev) => ({ ...prev, [key]: newUrls }));
                    updateField(key, newUrls.map((u) => u.trim()).filter(Boolean).join(","));
                  };

                  return (
                    <div key={key} className="col-span-1 lg:col-span-2">
                      {label}
                      <div
                        className="p-5 rounded-2xl space-y-4 border-t-[#ffffff21] border-r-[#ffffff21] border-b-[#ffffff21] border-l-[#ffffff21] bg-[#060a1424]"
                        style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase tracking-widest text-[#ffffff]" style={{ color: "var(--app-muted-color)" }}>
                            Media Gallery ({urls.filter(Boolean).length}/5 screenshots)
                          </p>
                          {urls.length < 5 ? (
                            <button
                              type="button"
                              onClick={() => setUrls([...urls, ""])}
                              className="flex gap-1.5 uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all justify-between items-center text-[8px] text-center flex-row font-semibold text-popover-foreground"
                              style={{
                                background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                                border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                                color: "var(--app-primary)",
                              }}
                            >
                              <PlusSquare size={12} /> Add Screenshot
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>Max 5 reached</span>
                          )}
                        </div>

                        {urls.map((urlVal, idx) => {
                          const urlValid = urlVal ? isValidUrl(urlVal) : false;
                          const isTv = urlVal ? isValidTradingViewUrl(urlVal) : false;
                          const errKey = `${key}_${idx}`;
                          const urlErr = tvErrors[errKey];
                          return (
                            <div key={idx} className="space-y-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-black uppercase tracking-widest w-16 flex-shrink-0 text-[#f5f6f7]" style={{ color: "var(--app-muted-color)" }}>
                                  Link {idx + 1}
                                </span>
                                <div className="relative flex-1">
                                  <input
                                    type="url"
                                    className="input-field pr-24 text-sm"
                                    value={urlVal}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const updated = [...urls];
                                      updated[idx] = val;
                                      setUrls(updated);
                                      if (val && !isValidUrl(val)) {
                                        setTvErrors((prev) => ({ ...prev, [errKey]: "Invalid URL — must start with https://" }));
                                      } else {
                                        setTvErrors((prev) => { const n = { ...prev }; delete n[errKey]; return n; });
                                      }
                                    }}
                                    onFocus={() => setFocusedField(`${key}_${idx}`)}
                                    onBlur={() => setFocusedField(null)}
                                    placeholder="https://..."
                                    data-testid={`input-url-${idx}`}
                                  />
                                  {urlVal && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                      {urlValid ? (
                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                                          style={{ background: "color-mix(in srgb, var(--app-success) 15%, transparent)", color: "var(--app-success)" }}>
                                          ✓ Valid
                                        </span>
                                      ) : urlVal.length > 3 ? (
                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                                          style={{ background: "color-mix(in srgb, var(--app-danger) 15%, transparent)", color: "var(--app-danger)" }}>
                                          ❌ Invalid
                                        </span>
                                      ) : null}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updated = urls.filter((_, i) => i !== idx);
                                          setUrls(updated.length === 0 ? [""] : updated);
                                          setTvErrors((prev) => { const n = { ...prev }; delete n[errKey]; return n; });
                                        }}
                                        className="p-1 rounded-lg"
                                        style={{ color: "var(--app-muted-color)" }}
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {urlErr && (
                                <div className="flex items-center gap-2 text-[11px] font-medium ml-[4.5rem]"
                                  style={{ color: "var(--app-danger)" }}>
                                  <AlertCircle size={11} /> {urlErr}
                                </div>
                              )}
                              {isTv && (
                                <div className="ml-[4.5rem]">
                                  <TradingViewCard
                                    url={urlVal}
                                    compact
                                    onClick={() => window.open(urlVal, "_blank")}
                                  />
                                </div>
                              )}
                              {urlValid && !isTv && (
                                <div className="ml-[4.5rem]">
                                  <a
                                    href={urlVal}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest w-fit transition-all"
                                    style={{
                                      background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                                      border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                                      color: "var(--app-primary)",
                                    }}
                                  >
                                    <Activity size={11} /> Open Link
                                  </a>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {urls.every(u => !u) && (
                          <p className="text-[10px] font-medium text-[#e60202]" style={{ color: "var(--app-muted-color)" }}>
                            Paste any screenshot or chart link (https://...) — up to 5 URLs
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                if (prop.type === "checkbox") {
                  const checked = !!form[key];
                  return (
                    <div key={key} className="flex items-end">
                      <button
                        type="button"
                        onClick={() => updateField(key, !checked)}
                        className="w-full flex items-center justify-between rounded-2xl px-6 py-4 transition-all duration-300 text-[#dee6ed]"
                        style={{
                          border: `1px solid ${checked ? "var(--app-primary)" : "var(--app-border)"}`,
                          background: checked
                            ? "color-mix(in srgb, var(--app-primary) 5%, transparent)"
                            : "var(--app-card)",
                          boxShadow: checked
                            ? "inset 0 0 0 4px color-mix(in srgb, var(--app-primary) 5%, transparent)"
                            : "none",
                        }}
                        data-testid={`checkbox-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      >
                        <span
                          className="text-[10px] font-black uppercase tracking-widest text-card-foreground"
                          style={{ color: checked ? "var(--app-primary)" : "var(--app-muted-color)" }}
                        >
                          {key}
                        </span>
                        <div
                          className="w-12 h-6 rounded-full relative transition-colors text-[#dee6ed] border-t-[0px] border-r-[0px] border-b-[0px] border-l-[0px] border-t-[color:var(--app-muted-color)] border-r-[color:var(--app-muted-color)] border-b-[color:var(--app-muted-color)] border-l-[color:var(--app-muted-color)] pl-[12px] pr-[12px] pt-[0px] pb-[0px] mt-[-21px] mb-[-21px] rounded-tl-[33554437px] rounded-tr-[33554437px] rounded-br-[33554437px] rounded-bl-[33554437px] opacity-[1] bg-[#c94b32]"
                          style={{ background: checked ? "var(--app-primary)" : "var(--app-border)" }}
                        >
                          <div
                            className="absolute top-1 w-4 h-4 rounded-full transition-all shadow-md"
                            style={{
                              background: "var(--app-card)",
                              left: checked ? "1.75rem" : "0.25rem",
                            }}
                          />
                        </div>
                      </button>
                    </div>
                  );
                }

                return null;
              })}
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex flex-col md:flex-row items-center justify-between gap-8 mt-[23px] rounded-tl-[10px] rounded-tr-[10px] rounded-bl-[10px] rounded-br-[10px] bg-[#06091300] ml-[2px] pl-[16px] pt-[8px] pr-[5px] pb-[8px] border-b-[#6384ff52] border-l-[#63b9ff75] border-r-[#60aeeb7d] border-t-[0px] border-r-[1px] border-b-[0px] border-l-[1px]"
          style={{ borderTop: "1px solid var(--app-border)" }}
        >
          <div className="flex flex-col gap-2" style={{ color: "var(--app-muted-color)" }}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--app-success)", boxShadow: "0 0 8px var(--app-success)" }}
                />
                <span className="text-[10px] font-black tracking-widest uppercase">Edge Ready</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--app-primary)", boxShadow: "0 0 8px var(--app-primary)" }}
                />
                <span className="text-[10px] font-black tracking-widest uppercase">Verified Sync</span>
              </div>
            </div>
            <p className="text-[10px] font-medium italic">
              Committing to your journal builds long-term profitability.
            </p>
          </div>

          <div className="flex gap-4 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setForm({})}
              className="flex-1 md:flex-none btn-outline font-bold bg-ring rounded-tl-[10px] rounded-tr-[10px] rounded-bl-[10px] rounded-br-[10px] text-base text-foreground pl-[24px] pr-[24px] pt-[0px] pb-[0px] mt-[1px] mb-[1px]"
              data-testid="button-discard-trade"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={createTrade.isPending}
              className="flex-1 md:flex-none btn-primary md:min-w-[180px] text-center font-bold border-t-[color:var(--app-border)] border-r-[color:var(--app-border)] border-b-[color:var(--app-border)] border-l-[color:var(--app-border)] bg-[#dee6ed] rounded-tl-[10px] rounded-tr-[10px] rounded-bl-[10px] rounded-br-[10px] text-[14px] pl-[12px] pr-[12px] mt-[0px] mb-[0px] pt-[4px] pb-[4px] ml-[7px] mr-[7px]"
              data-testid="button-submit-trade"
            >
              {createTrade.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Activity size={20} className="animate-pulse" />
                  <span>Log to Notion</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
      <AnimatePresence>
        {optionManager && (
          <OptionManagerModal
            propertyName={optionManager.propertyName}
            propertyType={optionManager.propertyType}
            options={optionManager.options}
            onClose={() => setOptionManager(null)}
          />
        )}
      </AnimatePresence>
      </div>
    </section>
  );
}
