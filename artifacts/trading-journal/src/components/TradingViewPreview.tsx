import { useState } from "react";
import { ExternalLink, X, TrendingUp, BarChart2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function extractTradingViewId(url: string): string | null {
  const match = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

export function isValidTradingViewUrl(url: string): boolean {
  return !!extractTradingViewId(url);
}

export function isValidUrl(url: string): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function TradingViewCard({
  url,
  compact = false,
  onClear,
  onClick,
}: {
  url: string;
  compact?: boolean;
  onClear?: () => void;
  onClick?: () => void;
}) {
  const chartId = extractTradingViewId(url);
  const snapshotUrl = chartId ? `https://s3.tradingview.com/snapshots/x/${chartId}.png` : null;
  const [imgFailed, setImgFailed] = useState(false);

  if (!chartId) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
        style={{
          background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
          color: "var(--app-primary)",
        }}
        title="View chart"
      >
        <BarChart2 size={12} />
        <span className="text-[10px] font-black uppercase tracking-widest">Chart</span>
      </button>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--app-border)", background: "var(--app-card)" }}
    >
      {snapshotUrl && !imgFailed ? (
        <div className="relative w-full aspect-video">
          <img
            src={snapshotUrl}
            alt="TradingView chart"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
          <div
            className="absolute inset-0 opacity-0 hover:opacity-100 transition-all flex items-center justify-center gap-3"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
          >
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} /> Open Chart
            </a>
          </div>
        </div>
      ) : (
        <div
          className="w-full aspect-video flex flex-col items-center justify-center gap-3"
          style={{ background: "color-mix(in srgb, var(--app-primary) 5%, transparent)" }}
        >
          <TrendingUp size={32} style={{ color: "var(--app-primary)", opacity: 0.6 }} />
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
            TradingView Chart
          </p>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={14} style={{ color: "var(--app-primary)", flexShrink: 0 }} />
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>
              TradingView
            </p>
            <p className="text-[10px] font-medium truncate" style={{ color: "var(--app-muted-color)" }}>
              {chartId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
            style={{
              background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
              color: "var(--app-primary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={11} /> View
          </a>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="p-1.5 rounded-lg transition-all"
              style={{
                background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)",
                color: "var(--app-danger)",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChartModal({ url, onClose }: { url: string; onClose: () => void }) {
  const chartId = extractTradingViewId(url);
  const snapshotUrl = chartId ? `https://s3.tradingview.com/snapshots/x/${chartId}.png` : null;
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="glass-card w-full md:max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden flex flex-col"
          style={{ maxHeight: "90vh" }}
        >
          <div
            className="flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--app-border)" }}
          >
            <div className="flex items-center gap-2">
              <TrendingUp size={18} style={{ color: "var(--app-primary)" }} />
              <div>
                <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>TradingView Chart</p>
                <p className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
                  ID: {chartId}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl transition-all"
              style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {snapshotUrl && !imgFailed ? (
              <img
                src={snapshotUrl}
                alt="TradingView chart"
                className="w-full"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div
                className="w-full aspect-video flex flex-col items-center justify-center gap-4"
                style={{ background: "color-mix(in srgb, var(--app-primary) 5%, transparent)" }}
              >
                <TrendingUp size={48} style={{ color: "var(--app-primary)", opacity: 0.4 }} />
                <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
                  Chart preview not available
                </p>
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
            style={{ borderTop: "1px solid var(--app-border)" }}
          >
            <p className="text-xs font-medium truncate flex-1" style={{ color: "var(--app-muted-color)" }}>
              {url}
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn-primary flex-shrink-0 text-sm px-5 py-2.5"
            >
              <ExternalLink size={15} />
              Open in TradingView
            </a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
