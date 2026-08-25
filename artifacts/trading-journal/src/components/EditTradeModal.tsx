import { useMemo, useState } from "react";
import { X, Loader2, Save, Star, AlertCircle, PlusSquare, ExternalLink } from "lucide-react";
import { useUpdateTrade, getGetTradesQueryKey, useGetNotionSchema } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TradingViewCard, isValidTradingViewUrl, isValidUrl } from "./TradingViewPreview";

interface EditTradeModalProps {
  trade: Record<string, any>;
  onClose: () => void;
  onSaved: (updated: Record<string, any>) => void;
}

function groupFields(schema: Record<string, any>) {
  const priority = [
    "Name", "Date", "Direction", "Pairs", "Session",
    "Entry Window (New York Time)", "Profit/Loss", "Rating(1-5)",
    "Emotion", "Negative tags", "entry", "reversal /condi",
    "Followed rules", "Lq taken", "DOW", "Month", "Year",
    "Files & media", "Entry",
  ];
  const ordered: string[] = [];
  const seen = new Set<string>();

  priority.forEach((k) => {
    if (schema[k] && schema[k].type !== "formula") {
      ordered.push(k);
      seen.add(k);
    }
  });

  Object.keys(schema).forEach((k) => {
    if (!seen.has(k) && schema[k].type !== "formula") {
      ordered.push(k);
      seen.add(k);
    }
  });

  const half = Math.ceil(ordered.length / 2);
  return {
    left: ordered.slice(0, half),
    right: ordered.slice(half),
    all: ordered,
  };
}

function normalizeInitial(trade: Record<string, any>, schema: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [key, prop] of Object.entries(schema)) {
    if (prop.type === "formula") continue;
    const raw = trade[key];
    if (raw !== undefined && raw !== null) {
      out[key] = raw;
    } else {
      if (prop.type === "number") out[key] = "";
      else if (prop.type === "checkbox") out[key] = false;
      else out[key] = "";
    }
  }
  return out;
}

export default function EditTradeModal({ trade, onClose, onSaved }: EditTradeModalProps) {
  const queryClient = useQueryClient();
  const { data: schemaData, isLoading: isLoadingSchema } = useGetNotionSchema();
  const schema = schemaData?.schema as Record<string, any> | undefined;

  const initialForm = useMemo(() => {
    if (!schema) return { ...trade };
    return normalizeInitial(trade, schema);
  }, [schema, trade]);

  const [form, setForm] = useState<Record<string, any>>(initialForm);
  const [error, setError] = useState("");
  const [tvErrors, setTvErrors] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const updateTrade = useUpdateTrade();

  function updateField(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError("");
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(form)) {
      if (value !== undefined && value !== null && value !== "") {
        payload[key] = value;
      }
    }
    try {
      const updated = await updateTrade.mutateAsync({ id: trade.id, data: payload });
      queryClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
      onSaved(updated as Record<string, any>);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to update trade. Please try again.");
    }
  }

  const labelStyle = {
    color: "var(--app-muted-color)",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    marginBottom: "6px",
    display: "block",
  };

  function renderField(key: string) {
    const prop = schema?.[key];
    const propType = prop?.type;
    const value = form[key] ?? "";
    const isFocused = focusedField === key;

    if (key === "Rating(1-5)") {
      const rating = Number(value) || 0;
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => updateField(key, star)}
                style={{ color: star <= rating ? "#EAB308" : "var(--app-border)" }}
                className="transition-colors"
              >
                <Star size={22} fill={star <= rating ? "currentColor" : "none"} strokeWidth={star <= rating ? 1 : 2} />
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (propType === "files") {
      const rawVal = String(value || "");
      const urls: string[] = rawVal
        ? rawVal.split(",").map((s) => s.trim()).filter(Boolean)
        : [""];

      function setUrls(newUrls: string[]) {
        updateField(key, newUrls.map((u) => u.trim()).filter(Boolean).join(","));
      }

      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <div className="p-4 rounded-2xl space-y-3" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Screenshots ({urls.filter(Boolean).length}/5)
              </p>
              {urls.length < 5 ? (
                <button
                  type="button"
                  onClick={() => setUrls([...urls, ""])}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all"
                  style={{
                    background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                    color: "var(--app-primary)",
                  }}
                >
                  <PlusSquare size={12} /> Add Link
                </button>
              ) : (
                <span className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>Maximum 5 links reached</span>
              )}
            </div>

            {urls.map((urlVal, idx) => {
              const valid = urlVal ? isValidUrl(urlVal) : false;
              const isTv = urlVal ? isValidTradingViewUrl(urlVal) : false;
              const errKey = `${key}_${idx}`;
              const urlErr = tvErrors[errKey];
              return (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest w-10 flex-shrink-0" style={{ color: "var(--app-muted-color)" }}>
                      URL {idx + 1}
                    </span>
                    <div className="relative flex-1">
                      <input
                        type="url"
                        className="input-field pr-28 text-sm"
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
                        style={focusedField === `${key}_${idx}` ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}}
                      />
                      {urlVal && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                          {valid ? (
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
                          <button type="button"
                            onClick={() => {
                              const updated = urls.filter((_, i) => i !== idx);
                              setUrls(updated.length === 0 ? [""] : updated);
                              setTvErrors((prev) => { const n = { ...prev }; delete n[errKey]; return n; });
                            }}
                            className="p-1 rounded-lg" style={{ color: "var(--app-muted-color)" }}>
                            <X size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {urlErr && (
                    <div className="flex items-center gap-2 text-[11px] font-medium ml-12" style={{ color: "var(--app-danger)" }}>
                      <AlertCircle size={11} /> {urlErr}
                    </div>
                  )}
                  {isTv && (
                    <div className="ml-12">
                      <TradingViewCard
                        url={urlVal}
                        compact
                        onClick={() => window.open(urlVal, "_blank")}
                      />
                    </div>
                  )}
                  {valid && !isTv && (
                    <div className="ml-12">
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
                        <ExternalLink size={11} /> Open Link
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (key === "Direction" || (propType === "select" && key === "Direction")) {
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <div className="flex gap-2">
            {["Buy", "Sell"].map((opt) => (
              <button key={opt} type="button" onClick={() => updateField(key, opt)}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  background: form[key] === opt ? "var(--app-primary)" : "var(--app-card)",
                  border: `1px solid ${form[key] === opt ? "var(--app-primary)" : "var(--app-border)"}`,
                  color: form[key] === opt ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (key === "Followed rules") {
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <div className="flex gap-2">
            {["Yes", "No"].map((opt) => (
              <button key={opt} type="button" onClick={() => updateField(key, opt)}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  background: form[key] === opt ? "var(--app-primary)" : "var(--app-card)",
                  border: `1px solid ${form[key] === opt ? "var(--app-primary)" : "var(--app-border)"}`,
                  color: form[key] === opt ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (propType === "select") {
      const options: string[] = prop?.select?.options?.map((o: any) => o.name) ?? [];
      if (options.length > 0) {
        return (
          <div key={key}>
            <label style={labelStyle}>{key}</label>
            <select value={String(value)} onChange={(e) => updateField(key, e.target.value)} className="input-field">
              <option value="">— select —</option>
              {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        );
      }
    }

    if (propType === "multi_select") {
      const options: string[] = prop?.multi_select?.options?.map((o: any) => o.name) ?? [];
      const selected = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const isOn = selected.includes(opt);
              return (
                <button key={opt} type="button"
                  onClick={() => {
                    const next = isOn ? selected.filter((s) => s !== opt) : [...selected, opt];
                    updateField(key, next.join(", "));
                  }}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{
                    background: isOn ? "var(--app-primary)" : "var(--app-card)",
                    border: `1px solid ${isOn ? "var(--app-primary)" : "var(--app-border)"}`,
                    color: isOn ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                  }}>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (propType === "checkbox") {
      const checked = value === true || value === "Yes" || value === "true";
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <button type="button" onClick={() => updateField(key, checked ? "No" : "Yes")}
            className="flex-1 w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{
              background: checked ? "var(--app-primary)" : "var(--app-card)",
              border: `1px solid ${checked ? "var(--app-primary)" : "var(--app-border)"}`,
              color: checked ? "var(--app-primary-fg)" : "var(--app-muted-color)",
            }}>
            {checked ? "Yes" : "No"}
          </button>
        </div>
      );
    }

    if (propType === "date" || key === "Date") {
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <input type="date" value={String(value)} onChange={(e) => updateField(key, e.target.value)}
            onFocus={() => setFocusedField(key)} onBlur={() => setFocusedField(null)}
            className="input-field"
            style={isFocused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}}
          />
        </div>
      );
    }

    if (propType === "number" || key === "Profit/Loss") {
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <input type="number" value={String(value)} onChange={(e) => updateField(key, e.target.value)}
            onFocus={() => setFocusedField(key)} onBlur={() => setFocusedField(null)}
            className="input-field" step="any"
            style={isFocused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}}
          />
        </div>
      );
    }

    if (propType === "rich_text") {
      return (
        <div key={key}>
          <label style={labelStyle}>{key}</label>
          <textarea value={String(value)} onChange={(e) => updateField(key, e.target.value)}
            onFocus={() => setFocusedField(key)} onBlur={() => setFocusedField(null)}
            className="input-field" rows={3} style={{ resize: "vertical",
              ...(isFocused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}) }}
          />
        </div>
      );
    }

    return (
      <div key={key}>
        <label style={labelStyle}>{key}</label>
        <input type="text" value={String(value)} onChange={(e) => updateField(key, e.target.value)}
          onFocus={() => setFocusedField(key)} onBlur={() => setFocusedField(null)}
          className="input-field"
          style={isFocused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--app-primary) 10%, transparent)" } : {}}
        />
      </div>
    );
  }

  const { left, right } = useMemo(() => {
    if (!schema) return { left: [] as string[], right: [] as string[] };
    return groupFields(schema);
  }, [schema]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        style={{ boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}
      >
        <div
          className="flex items-center justify-between px-8 py-6 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--app-border)" }}
        >
          <div>
            <h2 className="text-xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
              Edit Trade
            </h2>
            <p className="text-xs font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
              {trade["Name"] || "Untitled"} · Changes sync to Notion instantly
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-all"
            style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6">
          {isLoadingSchema ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--app-primary)" }} />
            </div>
          ) : (
            <>
              <div className="mb-6">{schema?.["Rating(1-5)"] && renderField("Rating(1-5)")}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="flex flex-col gap-5">{left.filter((k) => k !== "Rating(1-5)").map(renderField)}</div>
                <div className="flex flex-col gap-5">{right.filter((k) => k !== "Rating(1-5)").map(renderField)}</div>
              </div>
            </>
          )}

          {error && (
            <div
              className="mt-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)",
                color: "var(--app-danger)",
              }}
            >
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-3 px-8 py-5 flex-shrink-0"
          style={{ borderTop: "1px solid var(--app-border)" }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateTrade.isPending || isLoadingSchema}
            className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all"
            style={{
              background: "var(--app-primary)",
              color: "var(--app-primary-fg)",
              opacity: (updateTrade.isPending || isLoadingSchema) ? 0.7 : 1,
            }}
          >
            {updateTrade.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Saving...</>
            ) : (
              <><Save size={14} /> Save to Notion</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
