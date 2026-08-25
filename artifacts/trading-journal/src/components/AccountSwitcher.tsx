import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, Layers } from "lucide-react";
import { useAccount } from "../context/AccountContext";

export default function AccountSwitcher({ compact = false }: { compact?: boolean }) {
  const { accounts, selectedAccount, setSelectedAccount, accountColors } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (accounts.length === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}>
        <Layers size={15} style={{ color: "var(--app-muted-color)" }} />
        <span className="text-xs font-bold" style={{ color: "var(--app-muted-color)" }}>All Accounts</span>
      </div>
    );
  }

  const currentColor = selectedAccount ? accountColors[selectedAccount] : "var(--app-primary)";
  const currentLabel = selectedAccount ?? "All";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={compact
          ? "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all font-bold text-xs"
          : "flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all font-bold text-sm"
        }
        style={{
          background: "var(--app-card)",
          border: "1px solid var(--app-border)",
          color: "var(--app-text)",
        }}
      >
        {selectedAccount && (
          <div
            className={compact ? "w-1.5 h-1.5 rounded-full flex-shrink-0" : "w-2 h-2 rounded-full flex-shrink-0"}
            style={{ background: currentColor, boxShadow: `0 0 6px ${currentColor}` }}
          />
        )}
        {!selectedAccount && <Layers size={compact ? 12 : 14} style={{ color: "var(--app-muted-color)" }} />}
        <span className={compact ? "max-w-[90px] truncate" : "max-w-[140px] truncate"}>{currentLabel}</span>
        <ChevronDown
          size={compact ? 11 : 14}
          className="transition-transform flex-shrink-0"
          style={{
            color: "var(--app-muted-color)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-2 z-50 min-w-[200px] rounded-2xl overflow-hidden shadow-xl"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
          >
            <div className="p-2 bg-[#0609130a]">
              <p className="text-[9px] font-black uppercase tracking-widest px-3 py-2" style={{ color: "var(--app-muted-color)" }}>
                Switch Account
              </p>

              {/* All Accounts option */}
              <button
                onClick={() => { setSelectedAccount(null); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: !selectedAccount ? "color-mix(in srgb, var(--app-primary) 10%, transparent)" : "transparent",
                  color: !selectedAccount ? "var(--app-primary)" : "var(--app-text)",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <Layers size={14} style={{ color: !selectedAccount ? "var(--app-primary)" : "var(--app-muted-color)" }} />
                  <span>All Accounts</span>
                </div>
                {!selectedAccount && <Check size={13} style={{ color: "var(--app-primary)" }} />}
              </button>

              {/* Per-account options */}
              {accounts.map((account) => {
                const isActive = selectedAccount === account;
                const color = accountColors[account] ?? "var(--app-primary)";
                return (
                  <button
                    key={account}
                    onClick={() => { setSelectedAccount(account); setOpen(false); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: isActive ? `color-mix(in srgb, ${color} 10%, transparent)` : "transparent",
                      color: isActive ? color : "var(--app-text)",
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="truncate max-w-[130px]">{account}</span>
                    </div>
                    {isActive && <Check size={13} style={{ color }} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
