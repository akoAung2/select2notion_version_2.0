import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, CheckCircle, Loader2, Database, ChevronRight,
  SkipForward, AlertCircle, Link2, PlusSquare, Trash2,
} from "lucide-react";
import { useAiConfirmAction, useGetNotionSchema } from "@workspace/api-client-react";
import type { PendingAction } from "@workspace/api-client-react";
import { auth } from "../lib/firebase";
import { isValidUrl } from "./TradingViewPreview";

type WizardStep = "preview" | "fill" | "media" | "saving" | "verifying" | "done" | "error";

const SKIP_TYPES = new Set([
  "formula", "created_time", "created_by", "last_edited_time",
  "last_edited_by", "rollup", "relation", "unique_id", "verification",
]);

interface MissingProp {
  key: string;
  type: string;
  options: string[];
}

function getMissingProps(
  schema: Record<string, any>,
  extracted: Record<string, unknown>,
): MissingProp[] {
  const result: MissingProp[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (SKIP_TYPES.has(prop.type)) continue;
    if (prop.type === "files") continue;
    const val = extracted[key];
    if (val !== undefined && val !== null && val !== "") continue;
    result.push({
      key,
      type: prop.type as string,
      options: prop.select?.options?.map((o: any) => o.name)
        ?? prop.multi_select?.options?.map((o: any) => o.name)
        ?? [],
    });
    if (result.length >= 8) break;
  }
  return result;
}

const labelStyle: React.CSSProperties = {
  color: "var(--app-muted-color)",
  fontSize: "10px",
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: "6px",
  display: "block",
};

function FillField({
  prop,
  value,
  onChange,
}: {
  prop: MissingProp;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const str = String(value ?? "");

  if (prop.type === "select" && prop.options.length > 0) {
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <div className="flex flex-wrap gap-1.5">
          {prop.options.map((opt) => (
            <button key={opt} type="button"
              onClick={() => onChange(str === opt ? "" : opt)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
              style={{
                background: str === opt ? "var(--app-primary)" : "var(--app-card)",
                border: `1px solid ${str === opt ? "var(--app-primary)" : "var(--app-border)"}`,
                color: str === opt ? "var(--app-primary-fg)" : "var(--app-muted-color)",
              }}>
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (prop.type === "multi_select" && prop.options.length > 0) {
    const selected = str.split(",").map((s) => s.trim()).filter(Boolean);
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <div className="flex flex-wrap gap-1.5">
          {prop.options.map((opt) => {
            const isOn = selected.includes(opt);
            return (
              <button key={opt} type="button"
                onClick={() => {
                  const next = isOn ? selected.filter((s) => s !== opt) : [...selected, opt];
                  onChange(next.join(", "));
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

  if (prop.type === "checkbox") {
    const checked = value === true || value === "Yes" || value === "true";
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <button type="button" onClick={() => onChange(checked ? "No" : "Yes")}
          className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
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

  if (prop.type === "date") {
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <input type="date" className="input-field" value={str}
          onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  if (prop.type === "number") {
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <input type="number" className="input-field" value={str} step="any"
          onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  if (prop.type === "rich_text") {
    return (
      <div>
        <label style={labelStyle}>{prop.key}</label>
        <textarea className="input-field" rows={2} style={{ resize: "vertical" }}
          value={str} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  return (
    <div>
      <label style={labelStyle}>{prop.key}</label>
      <input type="text" className="input-field" value={str}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface Props {
  action: PendingAction;
  onComplete: (success: boolean, message: string) => void;
  onCancel: () => void;
}

export default function LogTradeWizard({ action, onComplete, onCancel }: Props) {
  const { data: schemaData, isLoading: schemaLoading } = useGetNotionSchema();
  const schema = schemaData?.schema as Record<string, any> | undefined;
  const { mutateAsync: confirmAction } = useAiConfirmAction();

  const extractedProps = (action.properties ?? {}) as Record<string, unknown>;
  const summary = (action.summary ?? {}) as Record<string, string>;

  const [step, setStep] = useState<WizardStep>("preview");
  const [fillValues, setFillValues] = useState<Record<string, unknown>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [mediaUrls, setMediaUrls] = useState<string[]>([""]);
  const [urlErrors, setUrlErrors] = useState<Record<number, string>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [savedPageId, setSavedPageId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<"ok" | "fail" | null>(null);

  const missingProps = schema ? getMissingProps(schema, extractedProps) : [];

  const hasValidMedia = mediaUrls.some((u) => u.trim() && isValidUrl(u.trim()));

  const onFillChange = (key: string, val: unknown) => {
    setFillValues((prev) => ({ ...prev, [key]: val }));
  };

  const toggleSkip = (key: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const proceedToSave = useCallback(async () => {
    setStep("saving");
    setErrorMsg("");

    const validMediaUrls = mediaUrls.map((u) => u.trim()).filter((u) => u && isValidUrl(u));

    const allProps: Record<string, unknown> = { ...extractedProps };
    for (const [k, v] of Object.entries(fillValues)) {
      if (!skipped.has(k) && v !== "" && v !== null && v !== undefined) {
        allProps[k] = v;
      }
    }

    const filesKey = schema
      ? Object.entries(schema).find(([, p]: [string, any]) => p.type === "files")?.[0]
      : undefined;
    if (filesKey && validMediaUrls.length > 0) {
      allProps[filesKey] = validMediaUrls.join(",");
    }

    try {
      const result = await confirmAction({
        data: {
          actionType: "save_trade",
          data: { properties: allProps },
        },
      });

      const r = result as { success: boolean; message: string; tradeId?: string };
      if (!r.success) {
        setErrorMsg(r.message || "Save failed.");
        setStep("error");
        return;
      }

      const pageId = r.tradeId ?? null;
      setSavedPageId(pageId);

      if (pageId) {
        setStep("verifying");
        await verifyPage(pageId);
      } else {
        setVerifyResult("ok");
        setStep("done");
      }
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || "Failed to save trade.");
      setStep("error");
    }
  }, [extractedProps, fillValues, skipped, mediaUrls, schema, confirmAction]);

  const verifyPage = async (pageId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch(`/api/notion/verify-page/${pageId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await resp.json()) as { success: boolean; exists?: boolean };
      if (data.success && data.exists) {
        setVerifyResult("ok");
        setStep("done");
      } else {
        setVerifyResult("fail");
        setStep("done");
      }
    } catch {
      setVerifyResult("fail");
      setStep("done");
    }
  };

  const entries = Object.entries(summary).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={(e) => { if (e.target === e.currentTarget && step !== "saving" && step !== "verifying") onCancel(); }}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="w-full max-w-sm rounded-3xl overflow-hidden"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--app-primary), var(--app-secondary))" }} />

          {/* ── PREVIEW STEP ── */}
          {step === "preview" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                    <Database size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Review Trade</h3>
                    <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                      AI extracted data
                    </p>
                  </div>
                </div>
                <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-2 mb-5 max-h-52 overflow-y-auto">
                {entries.map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                    style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>{key}</span>
                    <span className="text-sm font-black ml-3 text-right" style={{ color: "var(--app-text)" }}>{val}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={onCancel}
                  className="flex-1 py-3 rounded-2xl text-sm font-black"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (schemaLoading) return;
                    if (missingProps.length > 0) setStep("fill");
                    else setStep("media");
                  }}
                  disabled={schemaLoading}
                  className="flex-1 py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2"
                  style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
                  {schemaLoading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                  {schemaLoading ? "Loading…" : "Continue"}
                </button>
              </div>
            </div>
          )}

          {/* ── FILL MISSING STEP ── */}
          {step === "fill" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Missing Properties</h3>
                  <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                    Fill or skip each field
                  </p>
                </div>
                <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-4 max-h-64 overflow-y-auto mb-4">
                {missingProps.map((prop) => (
                  <div key={prop.key} className="p-3 rounded-2xl space-y-2"
                    style={{
                      background: skipped.has(prop.key) ? "var(--app-bg)" : "var(--app-bg)",
                      border: `1px solid ${skipped.has(prop.key) ? "var(--app-border)" : "var(--app-border)"}`,
                      opacity: skipped.has(prop.key) ? 0.5 : 1,
                    }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                        {prop.key}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleSkip(prop.key)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                        style={{
                          background: skipped.has(prop.key)
                            ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
                            : "color-mix(in srgb, var(--app-muted-color) 10%, transparent)",
                          color: skipped.has(prop.key) ? "var(--app-success)" : "var(--app-muted-color)",
                        }}>
                        <SkipForward size={9} />
                        {skipped.has(prop.key) ? "Restore" : "Skip"}
                      </button>
                    </div>
                    {!skipped.has(prop.key) && (
                      <FillField
                        prop={prop}
                        value={fillValues[prop.key] ?? ""}
                        onChange={(v) => onFillChange(prop.key, v)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("preview")}
                  className="flex-1 py-3 rounded-2xl text-sm font-black"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  Back
                </button>
                <button onClick={() => setStep("media")}
                  className="flex-1 py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2"
                  style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
                  <ChevronRight size={14} /> Continue
                </button>
              </div>
            </div>
          )}

          {/* ── MEDIA STEP ── */}
          {step === "media" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Files & Media</h3>
                  <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                    Add chart screenshots (optional)
                  </p>
                </div>
                <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                {mediaUrls.map((url, idx) => {
                  const valid = url.trim() ? isValidUrl(url.trim()) : null;
                  const hasErr = urlErrors[idx];
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest w-10 shrink-0"
                          style={{ color: "var(--app-muted-color)" }}>
                          URL {idx + 1}
                        </span>
                        <div className="relative flex-1">
                          <input
                            type="url"
                            className="input-field pr-8 text-sm"
                            value={url}
                            placeholder="https://..."
                            onChange={(e) => {
                              const val = e.target.value;
                              const next = [...mediaUrls];
                              next[idx] = val;
                              setMediaUrls(next);
                              if (val && !isValidUrl(val)) {
                                setUrlErrors((prev) => ({ ...prev, [idx]: "Must start with https://" }));
                              } else {
                                setUrlErrors((prev) => { const n = { ...prev }; delete n[idx]; return n; });
                              }
                            }}
                          />
                          {url && (
                            <button type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2"
                              onClick={() => {
                                const next = mediaUrls.filter((_, i) => i !== idx);
                                setMediaUrls(next.length === 0 ? [""] : next);
                                setUrlErrors((prev) => { const n = { ...prev }; delete n[idx]; return n; });
                              }}
                              style={{ color: "var(--app-muted-color)" }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {url && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full shrink-0"
                            style={{
                              background: valid ? "color-mix(in srgb, var(--app-success) 12%, transparent)" : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
                              color: valid ? "var(--app-success)" : "var(--app-danger)",
                            }}>
                            {valid ? "✓" : "✗"}
                          </span>
                        )}
                      </div>
                      {hasErr && (
                        <div className="ml-12 flex items-center gap-1 text-[10px]" style={{ color: "var(--app-danger)" }}>
                          <AlertCircle size={10} /> {hasErr}
                        </div>
                      )}
                    </div>
                  );
                })}
                {mediaUrls.length < 5 && (
                  <button type="button"
                    onClick={() => setMediaUrls((prev) => [...prev, ""])}
                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl w-full justify-center"
                    style={{
                      background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                      border: "1px dashed color-mix(in srgb, var(--app-primary) 25%, transparent)",
                      color: "var(--app-primary)",
                    }}>
                    <PlusSquare size={12} /> Add Link ({mediaUrls.length}/5)
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(missingProps.length > 0 ? "fill" : "preview")}
                  className="flex-1 py-3 rounded-2xl text-sm font-black"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  Back
                </button>
                <button onClick={proceedToSave}
                  disabled={Object.keys(urlErrors).length > 0}
                  className="flex-1 py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2"
                  style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)", opacity: Object.keys(urlErrors).length > 0 ? 0.6 : 1 }}>
                  <Database size={14} />
                  {hasValidMedia ? "Save with Media" : "Save Trade"}
                </button>
              </div>
            </div>
          )}

          {/* ── SAVING STEP ── */}
          {step === "saving" && (
            <div className="p-8 flex flex-col items-center gap-5">
              <div className="w-14 h-14 rounded-3xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)" }}>
                <Loader2 size={28} className="animate-spin" style={{ color: "var(--app-primary)" }} />
              </div>
              <div className="text-center">
                <h3 className="font-black text-base mb-1" style={{ color: "var(--app-text)" }}>Saving to Notion…</h3>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>Creating trade entry in your database</p>
              </div>
            </div>
          )}

          {/* ── VERIFYING STEP ── */}
          {step === "verifying" && (
            <div className="p-8 flex flex-col items-center gap-5">
              <div className="w-14 h-14 rounded-3xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--app-secondary) 10%, transparent)" }}>
                <Loader2 size={28} className="animate-spin" style={{ color: "var(--app-secondary)" }} />
              </div>
              <div className="text-center">
                <h3 className="font-black text-base mb-1" style={{ color: "var(--app-text)" }}>Verifying…</h3>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>Confirming trade exists in Notion</p>
              </div>
              <div className="w-full space-y-2">
                {[
                  { label: "Trade created in Notion", done: true },
                  { label: "Reading back from Notion", done: false, active: true },
                  { label: "Verification complete", done: false },
                ].map(({ label, done, active }) => (
                  <div key={label} className="flex items-center gap-2">
                    {done
                      ? <CheckCircle size={12} style={{ color: "var(--app-success)" }} />
                      : active
                      ? <Loader2 size={12} className="animate-spin" style={{ color: "var(--app-primary)" }} />
                      : <div className="w-3 h-3 rounded-full" style={{ background: "var(--app-border)" }} />}
                    <span className="text-xs font-medium" style={{ color: done || active ? "var(--app-text)" : "var(--app-muted-color)" }}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DONE STEP ── */}
          {step === "done" && (
            <div className="p-6 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-3xl flex items-center justify-center"
                style={{
                  background: verifyResult === "fail"
                    ? "color-mix(in srgb, #EAB308 10%, transparent)"
                    : "color-mix(in srgb, var(--app-success) 10%, transparent)",
                }}>
                {verifyResult === "fail"
                  ? <AlertCircle size={28} style={{ color: "#EAB308" }} />
                  : <CheckCircle size={28} style={{ color: "var(--app-success)" }} />}
              </div>
              <div className="text-center">
                <h3 className="font-black text-base mb-1" style={{ color: "var(--app-text)" }}>
                  {verifyResult === "fail" ? "Saved (unverified)" : "Trade Saved! ✅"}
                </h3>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
                  {verifyResult === "fail"
                    ? "Trade was created but verification couldn't confirm it. Check Notion directly."
                    : "Your trade has been saved and verified in Notion."}
                </p>
                {savedPageId && (
                  <a
                    href={`https://notion.so/${savedPageId.replace(/-/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-black uppercase tracking-widest"
                    style={{ color: "var(--app-primary)" }}>
                    <Link2 size={10} /> Open in Notion
                  </a>
                )}
              </div>
              <button onClick={() => onComplete(true, verifyResult === "fail"
                ? "Trade saved to Notion (verification inconclusive — check Notion directly)."
                : "Trade saved and verified in Notion! ✅")}
                className="w-full py-3 rounded-2xl text-sm font-black"
                style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
                Done
              </button>
            </div>
          )}

          {/* ── ERROR STEP ── */}
          {step === "error" && (
            <div className="p-6 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-3xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--app-danger) 10%, transparent)" }}>
                <AlertCircle size={28} style={{ color: "var(--app-danger)" }} />
              </div>
              <div className="text-center">
                <h3 className="font-black text-base mb-1" style={{ color: "var(--app-danger)" }}>Save Failed</h3>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>{errorMsg}</p>
              </div>
              <div className="flex gap-3 w-full">
                <button onClick={onCancel}
                  className="flex-1 py-3 rounded-2xl text-sm font-black"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  Cancel
                </button>
                <button onClick={() => setStep("media")}
                  className="flex-1 py-3 rounded-2xl text-sm font-black"
                  style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
                  Try Again
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
