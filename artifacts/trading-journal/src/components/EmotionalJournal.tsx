import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  X,
  Maximize2,
  Calendar,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Trade {
  id: string;
  Date: string;
  "Profit/Loss": number;
  Pairs?: string;
  Emotion?: string;
  [key: string]: any;
}

// ── Emotion colour map ─────────────────────────────────────────────────────
const EMOTION_COLORS: Record<string, { bg: string; text: string; highlight: string }> = {
  happy:        { bg: "#22C55E", text: "#fff",     highlight: "rgba(34,197,94,0.22)"  },
  excited:      { bg: "#22C55E", text: "#fff",     highlight: "rgba(34,197,94,0.22)"  },
  confident:    { bg: "#10B981", text: "#fff",     highlight: "rgba(16,185,129,0.22)" },
  calm:         { bg: "#8B5CF6", text: "#fff",     highlight: "rgba(139,92,246,0.22)" },
  focused:      { bg: "#7C3AED", text: "#fff",     highlight: "rgba(124,58,237,0.22)" },
  patient:      { bg: "#6D28D9", text: "#fff",     highlight: "rgba(109,40,217,0.22)" },
  neutral:      { bg: "#94A3B8", text: "#fff",     highlight: "rgba(148,163,184,0.2)" },
  sad:          { bg: "#3B82F6", text: "#fff",     highlight: "rgba(59,130,246,0.22)" },
  disappointed: { bg: "#60A5FA", text: "#fff",     highlight: "rgba(96,165,250,0.22)" },
  regret:       { bg: "#93C5FD", text: "#1e3a5f",  highlight: "rgba(147,197,253,0.22)"},
  angry:        { bg: "#EF4444", text: "#fff",     highlight: "rgba(239,68,68,0.22)"  },
  frustrated:   { bg: "#F87171", text: "#fff",     highlight: "rgba(248,113,113,0.22)"},
  fear:         { bg: "#DC2626", text: "#fff",     highlight: "rgba(220,38,38,0.22)"  },
  anxious:      { bg: "#F97316", text: "#fff",     highlight: "rgba(249,115,22,0.22)" },
  nervous:      { bg: "#FB923C", text: "#fff",     highlight: "rgba(251,146,60,0.22)" },
  stressed:     { bg: "#FBBF24", text: "#78350f",  highlight: "rgba(251,191,36,0.22)" },
  greedy:       { bg: "#F59E0B", text: "#fff",     highlight: "rgba(245,158,11,0.22)" },
  impatient:    { bg: "#EAB308", text: "#fff",     highlight: "rgba(234,179,8,0.22)"  },
  disciplined:  { bg: "#14B8A6", text: "#fff",     highlight: "rgba(20,184,166,0.22)" },
  motivated:    { bg: "#06B6D4", text: "#fff",     highlight: "rgba(6,182,212,0.22)"  },
};

function emotionColor(name: string) {
  return EMOTION_COLORS[name.toLowerCase()] ?? { bg: "#64748B", text: "#fff", highlight: "rgba(100,116,139,0.18)" };
}

// ── Highlight emotion words inside journal text ────────────────────────────
function HighlightedText({ text }: { text: string }) {
  const emotionWords = Object.keys(EMOTION_COLORS);
  const regex = new RegExp(`\\b(${emotionWords.join("|")})\\b`, "gi");

  const parts: Array<{ str: string; isEmotion: boolean; key: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ str: text.slice(lastIndex, match.index), isEmotion: false, key: `t${lastIndex}` });
    }
    parts.push({ str: match[0], isEmotion: true, key: `e${match.index}` });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ str: text.slice(lastIndex), isEmotion: false, key: `t${lastIndex}` });
  }

  return (
    <>
      {parts.map((p) =>
        p.isEmotion ? (
          <mark
            key={p.key}
            style={{
              background: emotionColor(p.str).highlight,
              color: "var(--app-text)",
              borderRadius: "4px",
              padding: "0 3px",
              fontWeight: 700,
            }}
          >
            {p.str}
          </mark>
        ) : (
          <span key={p.key}>{p.str}</span>
        )
      )}
    </>
  );
}

// ── Resolve journal text field — try several common Notion field names ──────
function getJournalText(trade: Trade): string {
  const candidates = [
    "Journal", "Notes", "Reflection", "Thoughts",
    "Comments", "Review", "Remarks", "Diary", "Note",
  ];
  for (const key of candidates) {
    const v = trade[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

// ── Collapse line counts ───────────────────────────────────────────────────
const CLAMP = { mobile: 2, tablet: 3, desktop: 5 };

// ── Single entry card ──────────────────────────────────────────────────────
function JournalEntry({
  trade,
  onOpenModal,
}: {
  trade: Trade;
  onOpenModal: (trade: Trade) => void;
}) {
  const text = getJournalText(trade);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const previewRef = useRef<HTMLParagraphElement>(null);

  const pnl = Number(trade["Profit/Loss"]) || 0;
  const dateFormatted = trade.Date
    ? new Date(trade.Date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const rawEmotions = String(trade["Emotion"] || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  // Detect if the clamped element is actually overflowing
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const check = () => setIsClamped(el.scrollHeight > el.clientHeight + 2);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text]);

  if (!text) return null;

  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200"
      style={{
        background: "var(--app-card)",
        border: "1px solid var(--app-border)",
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Calendar size={12} style={{ color: "var(--app-muted-color)" }} />
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
              {dateFormatted}
            </span>
          </div>
          {trade.Pairs && (
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                color: "var(--app-primary)",
              }}
            >
              {trade.Pairs}
            </span>
          )}
          {pnl !== 0 && (
            <div className="flex items-center gap-1">
              {pnl > 0
                ? <TrendingUp size={11} style={{ color: "var(--app-success)" }} />
                : <TrendingDown size={11} style={{ color: "var(--app-danger)" }} />}
              <span
                className="text-[11px] font-black"
                style={{ color: pnl > 0 ? "var(--app-success)" : "var(--app-danger)" }}
              >
                {pnl > 0 ? "+" : ""}${pnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>
        {/* Open full modal */}
        <button
          onClick={() => onOpenModal(trade)}
          className="p-1.5 rounded-xl flex-shrink-0 transition-opacity opacity-60 hover:opacity-100"
          style={{
            background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
            color: "var(--app-primary)",
          }}
          title="Expand full entry"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Emotion tags */}
      {rawEmotions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {rawEmotions.map((e) => {
            const c = emotionColor(e);
            return (
              <span
                key={e}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{ background: c.highlight, color: c.bg }}
              >
                {e}
              </span>
            );
          })}
        </div>
      )}

      {/* Journal text — collapsed by default */}
      <div className="relative">
        <p
          ref={previewRef}
          className="text-sm leading-relaxed transition-all duration-300"
          style={{
            color: "var(--app-text)",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: expanded ? "none" : CLAMP.desktop,
            overflow: expanded ? "visible" : "hidden",
          } as React.CSSProperties}
        >
          <HighlightedText text={text} />
        </p>

        {/* Fade gradient when collapsed */}
        {!expanded && isClamped && (
          <div
            className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, transparent, var(--app-card))",
            }}
          />
        )}
      </div>

      {/* Expand / collapse toggle */}
      {(isClamped || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 mt-3 text-[11px] font-black uppercase tracking-widest transition-opacity hover:opacity-80"
          style={{ color: "var(--app-primary)" }}
        >
          {expanded ? (
            <><ChevronUp size={13} /> Read Less</>
          ) : (
            <><ChevronDown size={13} /> Read More</>
          )}
        </button>
      )}
    </div>
  );
}

// ── Full-entry modal ────────────────────────────────────────────────────────
function JournalModal({
  trade,
  onClose,
}: {
  trade: Trade;
  onClose: () => void;
}) {
  const text = getJournalText(trade);
  const pnl  = Number(trade["Profit/Loss"]) || 0;
  const dateFormatted = trade.Date
    ? new Date(trade.Date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "—";
  const rawEmotions = String(trade["Emotion"] || "")
    .split(",").map((e) => e.trim()).filter(Boolean);

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      >
        <motion.div
          key="sheet"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 sm:p-8"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>
                Journal Entry
              </p>
              <h3 className="text-lg font-black tracking-tight" style={{ color: "var(--app-text)" }}>
                {dateFormatted}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl"
              style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap mb-5 pb-5" style={{ borderBottom: "1px solid var(--app-border)" }}>
            {trade.Pairs && (
              <span
                className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-xl"
                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}
              >
                {trade.Pairs}
              </span>
            )}
            {pnl !== 0 && (
              <div className="flex items-center gap-1.5">
                {pnl > 0
                  ? <TrendingUp size={13} style={{ color: "var(--app-success)" }} />
                  : <TrendingDown size={13} style={{ color: "var(--app-danger)" }} />}
                <span className="text-sm font-black" style={{ color: pnl > 0 ? "var(--app-success)" : "var(--app-danger)" }}>
                  {pnl > 0 ? "+" : ""}${pnl.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Emotions */}
          {rawEmotions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {rawEmotions.map((e) => {
                const c = emotionColor(e);
                return (
                  <span
                    key={e}
                    className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full"
                    style={{ background: c.highlight, color: c.bg, border: `1px solid ${c.bg}30` }}
                  >
                    {e}
                  </span>
                );
              })}
            </div>
          )}

          {/* Full journal text */}
          <p className="text-sm leading-[1.85] whitespace-pre-wrap" style={{ color: "var(--app-text)" }}>
            <HighlightedText text={text} />
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main exported component ─────────────────────────────────────────────────
export default function EmotionalJournal({ trades }: { trades: Trade[] }) {
  const [modalTrade, setModalTrade] = useState<Trade | null>(null);
  const [showAll, setShowAll]       = useState(false);

  // Only trades that have a journal entry, most recent first
  const journalTrades = trades
    .filter((t) => getJournalText(t).length > 0)
    .sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());

  if (journalTrades.length === 0) return null;

  const INITIAL_SHOW = 5;
  const visible = showAll ? journalTrades : journalTrades.slice(0, INITIAL_SHOW);

  return (
    <>
      <div
        className="rounded-3xl overflow-hidden"
        style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
      >
        {/* Header */}
        <div
          className="px-6 py-5 flex items-center justify-between"
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
              <BookOpen size={18} />
            </div>
            <div>
              <h3 className="font-black text-base tracking-tight" style={{ color: "var(--app-text)" }}>
                Trade Journal
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                {journalTrades.length} entr{journalTrades.length === 1 ? "y" : "ies"} · most recent first
              </p>
            </div>
          </div>
        </div>

        {/* Entry list */}
        <div className="p-5 space-y-4">
          <AnimatePresence initial={false}>
            {visible.map((trade) => (
              <motion.div
                key={trade.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <JournalEntry trade={trade} onOpenModal={setModalTrade} />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Show more / less */}
          {journalTrades.length > INITIAL_SHOW && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 6%, transparent)",
                border: "1px dashed color-mix(in srgb, var(--app-primary) 25%, transparent)",
                color: "var(--app-primary)",
              }}
            >
              {showAll ? (
                <><ChevronUp size={13} /> Show Less</>
              ) : (
                <><ChevronDown size={13} /> Show {journalTrades.length - INITIAL_SHOW} More</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Full-entry modal */}
      {modalTrade && (
        <JournalModal trade={modalTrade} onClose={() => setModalTrade(null)} />
      )}
    </>
  );
}
