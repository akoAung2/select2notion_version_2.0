import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Sparkles, Calendar, Globe, Loader2,
  Copy, RefreshCw, Download, CheckCircle, AlertCircle,
  Zap, Target, Clock, BarChart2, Shield, MessageSquare, X,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FlashCards {
  bestPerformingSetupSignature: string;
  timingPrecisionMap: string;
  contextAwareness: string;
  oneCoreFocus: string;
}

interface ReflectionResult {
  flashCards: FlashCards;
  summary: string;
  score: string;
  insights: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESETS = [
  { id: "execution-score",     label: "Execution Score",    icon: Target,       desc: "Rule adherence & discipline rating" },
  { id: "emotional-reflection",label: "Emotional Reflection",icon: Brain,       desc: "Emotion pattern analysis & coaching" },
  { id: "timing-analysis",     label: "Timing Analysis",    icon: Clock,        desc: "Best/worst session windows" },
  { id: "strategy-review",     label: "Strategy Review",    icon: BarChart2,    desc: "Setup & entry criteria effectiveness" },
  { id: "professional-review", label: "Professional Review",icon: Shield,       desc: "Elite prop firm coaching perspective" },
];

const FLASH_CARD_META = [
  { key: "bestPerformingSetupSignature" as keyof FlashCards, label: "Best Setup Signature",  icon: Target,   color: "var(--app-success)" },
  { key: "timingPrecisionMap"           as keyof FlashCards, label: "Timing Precision Map",  icon: Clock,    color: "var(--app-primary)" },
  { key: "contextAwareness"             as keyof FlashCards, label: "Context Awareness",     icon: Brain,    color: "#F59E0B" },
  { key: "oneCoreFocus"                 as keyof FlashCards, label: "One Core Focus",        icon: Zap,      color: "#EC4899" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function weeksAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n * 7);
  return d.toISOString().slice(0, 10);
}

async function getIdToken(): Promise<string | null> {
  return auth.currentUser?.getIdToken() ?? null;
}

async function hasAIProvider(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, "user_connections", user.uid));
    if (!snap.exists()) return false;
    const data = snap.data() as Record<string, string>;
    return !!(data.ai_provider && data.ai_api_key);
  } catch {
    return false;
  }
}

// ─── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: string }) {
  const num = parseInt(score.replace(/[^\d]/g, "")) || 0;
  const pct = Math.min(num, 100);
  const r = 36; const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = pct >= 75 ? "var(--app-success)" : pct >= 50 ? "#F59E0B" : "var(--app-danger)";
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--app-border)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="flex flex-col items-center -mt-16 mb-8">
        <span className="text-3xl font-black" style={{ color }}>{pct}</span>
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>/ 100</span>
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Score</span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AIReflection({ onGoToSettings }: { onGoToSettings: () => void }) {
  const [preset, setPreset]         = useState(PRESETS[0].id);
  const [dateFrom, setDateFrom]     = useState(weeksAgo(2));
  const [dateTo, setDateTo]         = useState(today());
  const [language, setLanguage]     = useState<"english" | "myanmar">("english");
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<ReflectionResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hasAIProvider().then(setAiAvailable);
  }, []);

  const selectedPreset = PRESETS.find((p) => p.id === preset)!;
  const PresetIcon = selectedPreset.icon;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const token = await getIdToken();
      if (!token) { setError("Please sign in again."); return; }

      const resp = await fetch("/api/ai/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preset, dateFrom, dateTo, language, customPrompt: customPrompt || undefined }),
      });

      const data = (await resp.json()) as ReflectionResult & { error?: string };
      if (!resp.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error — check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!result) return;
    const text = `${selectedPreset.label} — Score: ${result.score}\n\n${result.summary}\n\nKey Insights:\n${result.insights.map((i, n) => `${n + 1}. ${i}`).join("\n")}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleExport() {
    if (!result) return;
    const text = `# ${selectedPreset.label} — AI Trading Reflection\n\nDate Range: ${dateFrom} → ${dateTo}\nLanguage: ${language}\nScore: ${result.score}\n\n## Flash Cards\n\n${FLASH_CARD_META.map((c) => `### ${c.label}\n${result.flashCards[c.key]}`).join("\n\n")}\n\n## Summary\n\n${result.summary}\n\n## Key Insights\n\n${result.insights.map((i, n) => `${n + 1}. ${i}`).join("\n")}`;
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `ai-reflection-${preset}-${dateFrom}.md`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <header>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--app-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)" }}>
            <Brain size={20} style={{ color: "var(--app-primary)" }} />
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>AI Reflection</h2>
            <p className="font-medium text-sm" style={{ color: "var(--app-muted-color)" }}>
              AI-powered analysis of your trading journal
            </p>
          </div>
        </div>
      </header>

      {/* AI not configured banner */}
      {aiAvailable === false && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 flex items-center gap-4"
          style={{ borderColor: "color-mix(in srgb, #F59E0B 30%, transparent)", background: "color-mix(in srgb, #F59E0B 5%, transparent)" }}>
          <AlertCircle size={20} style={{ color: "#F59E0B", flexShrink: 0 }} />
          <div className="flex-1">
            <p className="font-black text-sm" style={{ color: "var(--app-text)" }}>AI Provider Not Connected</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>Add your Gemini or ChatGPT API key in Settings to enable AI Reflection.</p>
          </div>
          <button onClick={onGoToSettings}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex-shrink-0"
            style={{ background: "#F59E0B", color: "white" }}>
            Go to Settings
          </button>
        </motion.div>
      )}

      {/* Control bar */}
      <div className="glass-card p-6 space-y-5">
        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Configure Reflection</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Preset selector */}
          <div className="lg:col-span-3">
            <label className="text-[10px] font-black uppercase tracking-widest mb-3 block" style={{ color: "var(--app-muted-color)" }}>Preset</label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                const active = preset === p.id;
                return (
                  <button key={p.id} onClick={() => setPreset(p.id)}
                    className="flex flex-col items-start gap-2 p-3.5 rounded-2xl text-left transition-all"
                    style={{
                      background: active ? "color-mix(in srgb, var(--app-primary) 10%, transparent)" : "var(--app-bg)",
                      border: `1.5px solid ${active ? "var(--app-primary)" : "var(--app-border)"}`,
                      boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--app-primary) 20%, transparent)" : "none",
                    }}>
                    <Icon size={16} style={{ color: active ? "var(--app-primary)" : "var(--app-muted-color)" }} />
                    <span className="text-[11px] font-black leading-tight" style={{ color: active ? "var(--app-primary)" : "var(--app-text)" }}>{p.label}</span>
                    <span className="text-[9px] font-medium leading-tight hidden md:block" style={{ color: "var(--app-muted-color)" }}>{p.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
              <Calendar size={11} className="inline mr-1" /> From
            </label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
              <Calendar size={11} className="inline mr-1" /> To
            </label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="input-field w-full text-sm" />
          </div>

          {/* Language */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
              <Globe size={11} className="inline mr-1" /> Output Language
            </label>
            <div className="flex gap-2">
              {(["english", "myanmar"] as const).map((lang) => (
                <button key={lang} onClick={() => setLanguage(lang)}
                  className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{
                    background: language === lang ? "var(--app-primary)" : "var(--app-bg)",
                    border: `1px solid ${language === lang ? "var(--app-primary)" : "var(--app-border)"}`,
                    color: language === lang ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                  }}>
                  {lang === "english" ? "🇬🇧 EN" : "🇲🇲 MM"}
                </button>
              ))}
            </div>
          </div>

          {/* Custom prompt */}
          <div className="md:col-span-2 lg:col-span-3">
            <label className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "var(--app-muted-color)" }}>
              <MessageSquare size={11} /> Custom Focus (optional — max 200 chars)
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. Focus on my GBPUSD trades only..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value.slice(0, 200))}
                className="input-field w-full pr-14 text-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black tabular-nums"
                style={{ color: customPrompt.length > 160 ? "var(--app-danger)" : "var(--app-muted-color)" }}>
                {customPrompt.length}/200
              </span>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={loading || aiAvailable === false}
          className="btn-primary flex items-center gap-2 w-full md:w-auto"
          style={{ opacity: (loading || aiAvailable === false) ? 0.6 : 1 }}>
          {loading
            ? <><Loader2 size={18} className="animate-spin" /> Generating Reflection…</>
            : <><Sparkles size={18} /> Generate {selectedPreset.label}</>
          }
        </button>

        {aiAvailable === false && (
          <p className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
            Connect your AI provider in Settings to enable generation.
          </p>
        )}
      </div>

      {/* Error state */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass-card p-5 flex items-start gap-4"
            style={{ borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", background: "color-mix(in srgb, var(--app-danger) 5%, transparent)" }}>
            <AlertCircle size={18} style={{ color: "var(--app-danger)", flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1">
              <p className="font-black text-sm" style={{ color: "var(--app-danger)" }}>Generation Failed</p>
              <p className="text-xs font-medium mt-1" style={{ color: "var(--app-muted-color)" }}>{error}</p>
            </div>
            <button onClick={() => setError(null)}><X size={16} style={{ color: "var(--app-muted-color)" }} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[0,1,2,3].map((i) => (
                <div key={i} className="glass-card p-5 space-y-3 animate-pulse">
                  <div className="w-8 h-8 rounded-xl" style={{ background: "var(--app-border)" }} />
                  <div className="h-3 rounded" style={{ background: "var(--app-border)", width: "60%" }} />
                  <div className="h-12 rounded" style={{ background: "var(--app-border)" }} />
                </div>
              ))}
            </div>
            <div className="glass-card p-8 space-y-4 animate-pulse">
              <div className="h-4 rounded w-1/3" style={{ background: "var(--app-border)" }} />
              <div className="h-3 rounded" style={{ background: "var(--app-border)" }} />
              <div className="h-3 rounded w-5/6" style={{ background: "var(--app-border)" }} />
              <div className="h-3 rounded w-4/6" style={{ background: "var(--app-border)" }} />
              <div className="h-3 rounded w-3/4" style={{ background: "var(--app-border)" }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Score + meta banner */}
            <div className="glass-card p-6 flex flex-col md:flex-row items-center gap-6"
              style={{ borderColor: "color-mix(in srgb, var(--app-primary) 25%, transparent)", background: "color-mix(in srgb, var(--app-primary) 3%, transparent)" }}>
              <ScoreRing score={result.score} />
              <div className="flex-1 flex flex-col gap-1 text-center md:text-left">
                <div className="flex items-center gap-2 justify-center md:justify-start">
                  <PresetIcon size={16} style={{ color: "var(--app-primary)" }} />
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>{selectedPreset.label}</span>
                </div>
                <p className="font-black text-xl tracking-tight" style={{ color: "var(--app-text)" }}>
                  Reflection Complete
                </p>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
                  {dateFrom} → {dateTo} · {language === "myanmar" ? "Myanmar" : "English"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: copied ? "var(--app-success)" : "var(--app-muted-color)" }}>
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button onClick={handleGenerate}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  <RefreshCw size={14} /> Regenerate
                </button>
                <button onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  <Download size={14} /> Export
                </button>
              </div>
            </div>

            {/* Flash cards — 4 cards */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>Flash Cards</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {FLASH_CARD_META.map((card, i) => {
                  const CardIcon = card.icon;
                  const value = result.flashCards[card.key];
                  return (
                    <motion.div
                      key={card.key}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="glass-card p-5 flex flex-col gap-3 group hover:scale-[1.02] transition-transform"
                      style={{ borderColor: `color-mix(in srgb, ${card.color} 20%, transparent)` }}>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: `color-mix(in srgb, ${card.color} 12%, transparent)` }}>
                          <CardIcon size={16} style={{ color: card.color }} />
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-widest leading-tight" style={{ color: "var(--app-muted-color)" }}>
                          {card.label}
                        </span>
                      </div>
                      <p className="text-sm font-semibold leading-relaxed" style={{ color: "var(--app-text)" }}>
                        {value}
                      </p>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* AI Summary box */}
            <div className="glass-card overflow-hidden">
              <div className="px-6 pt-5 pb-4 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--app-border)" }}>
                <div className="flex items-center gap-2">
                  <Sparkles size={16} style={{ color: "var(--app-primary)" }} />
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>AI Summary</span>
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
                  {language === "myanmar" ? "Myanmar · max 500 words" : "English · max 300 words"}
                </span>
              </div>
              <div ref={summaryRef}
                className="px-6 py-5 max-h-80 overflow-y-auto"
                style={{ lineHeight: "1.8" }}>
                {result.summary.split("\n").filter(Boolean).map((para, i) => (
                  <p key={i} className="text-sm font-medium mb-3 last:mb-0" style={{ color: "var(--app-text)" }}>{para}</p>
                ))}
              </div>
            </div>

            {/* Key insights */}
            {result.insights.length > 0 && (
              <div className="glass-card p-6">
                <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>Key Insights</p>
                <div className="space-y-3">
                  {result.insights.map((insight, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.07 }}
                      className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)" }}>
                        <span className="text-[10px] font-black" style={{ color: "var(--app-primary)" }}>{i + 1}</span>
                      </div>
                      <p className="text-sm font-medium" style={{ color: "var(--app-text)", lineHeight: 1.6 }}>{insight}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
