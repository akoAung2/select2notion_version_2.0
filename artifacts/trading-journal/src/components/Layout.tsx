import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  PlusCircle,
  BarChart2,
  Calendar,
  Settings,
  Moon,
  Sun,
  LogOut,
  TrendingUp,
  ShieldCheck,
  Menu,
  X,
  RefreshCw,
  Brain, Mic,
  List,
  Zap,
  Newspaper,
} from "lucide-react";
import AccountSwitcher from "./AccountSwitcher";

const LOGO_URL = "/logo.jpg";

// ── Nav item definitions ───────────────────────────────────────────────────
const NAV_MAIN = [
  { id: "home",           label: "Overview",      shortLabel: "Home",     icon: LayoutDashboard },
  { id: "dashboard",     label: "Journal",       shortLabel: "Journal",  icon: TrendingUp },
  { id: "recent-trades", label: "Recent Trades", shortLabel: "Trades",   icon: List },
  { id: "new-trade",     label: "Log Trade",     shortLabel: "Log",      icon: PlusCircle },
  { id: "performance",   label: "Analytics",     shortLabel: "Stats",    icon: BarChart2 },
  { id: "trading-hub",   label: "Trading Hub",   shortLabel: "Hub",      icon: Zap },
  { id: "calendar",      label: "Calendar",      shortLabel: "Calendar", icon: Calendar },
  { id: "ai-reflection", label: "AI Agent",      shortLabel: "AI",       icon: Brain },
  { id: "voice-assistant", label: "Voice Assistant", shortLabel: "Voice", icon: Mic },
  { id: "news",          label: "News Intel",    shortLabel: "News",     icon: Newspaper },
  { id: "settings",      label: "Settings",      shortLabel: "Settings", icon: Settings },
];

// ── Desktop Sidebar ────────────────────────────────────────────────────────
export function Sidebar({
  activeTab,
  setActiveTab,
  isDarkMode,
  toggleTheme,
  onSignOut,
  isOwner,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  onSignOut: () => void;
  isOwner: boolean;
}) {
  return (
    <aside
      className="hidden lg:flex flex-col w-72 min-h-screen fixed left-0 top-0 bottom-0 z-40 bg-primary-foreground"
      style={{
        background: "var(--app-sidebar-bg)",
        borderRight: "1px solid var(--app-sidebar-border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Subtle inner glow top */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(var(--app-primary-rgb),0.3), transparent)",
        }}
      />
      {/* Logo */}
      <div className="p-7 pb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl overflow-hidden flex-shrink-0"
            style={{
              boxShadow: "0 0 16px rgba(var(--app-primary-rgb),0.5), 0 0 0 1px rgba(var(--app-primary-rgb),0.2)",
            }}
          >
            <img src={LOGO_URL} alt="TradeEdge logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1
              className="font-black text-base tracking-tight"
              style={{ color: "var(--app-sidebar-text)" }}
            >Select2notion</h1>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: "var(--app-sidebar-muted)" }}
            >
              Trading Journal
            </p>
          </div>
        </div>
      </div>
      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto ml-[-7px] mr-[-7px] mt-[0px] mb-[0px] pl-[14px] pr-[14px] pt-[39px] pb-[39px]">
        <p
          className="text-[8px] font-black uppercase tracking-[0.22em] px-4 mb-3 mt-1"
          style={{ color: "var(--app-sidebar-muted)" }}
        >
          Navigation
        </p>
        {NAV_MAIN.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`sidebar-link w-full mt-[-1px] mb-[7px] ${isActive ? "sidebar-link-active" : ""}`}
              data-testid={`nav-${item.id}`}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {isActive && (
                <div
                  className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--app-primary)" }}
                />
              )}
            </button>
          );
        })}

        {isOwner && (
          <>
            <p
              className="text-[8px] font-black uppercase tracking-[0.22em] px-4 mb-3 mt-5 text-[#ef4444d9]"
              style={{ color: "rgba(239,68,68,0.4)" }}
            >
              Owner Only
            </p>
            <button
              onClick={() => setActiveTab("admin")}
              className={`sidebar-link w-full ${activeTab === "admin" ? "sidebar-link-active" : ""}`}
              data-testid="nav-admin"
            >
              <ShieldCheck size={19} />
              <span className="text-[#e3b436]">Admin Center</span>
              {activeTab === "admin" && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--app-primary)" }} />
              )}
            </button>
          </>
        )}
      </nav>
      {/* Bottom */}
      <div className="p-5 space-y-3">
        {/* Theme toggle */}
        <div
          className="p-3.5 rounded-2xl pl-[12px] pr-[12px] bg-[#e5d9fe]"
          style={{
            background: isDarkMode ? "rgba(255,255,255,0.03)" : "rgba(37,99,235,0.04)",
            border: isDarkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(37,99,235,0.1)",
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              {isDarkMode
                ? <Moon size={14} style={{ color: "var(--app-primary)" }} />
                : <Sun size={14} style={{ color: "var(--app-primary)" }} />}
              <span
                className="text-[10px] font-black uppercase tracking-[0.15em]"
                style={{ color: "var(--app-sidebar-muted)" }}
              >
                {isDarkMode ? "Dark" : "Light"}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="w-11 h-6 rounded-full relative transition-all duration-300 flex-shrink-0"
              style={{
                background: isDarkMode
                  ? "rgba(var(--app-primary-rgb),0.4)"
                  : "rgba(37,99,235,0.15)",
                boxShadow: isDarkMode
                  ? "0 0 10px rgba(var(--app-primary-rgb),0.35)"
                  : "0 0 8px rgba(37,99,235,0.2)",
                border: isDarkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(37,99,235,0.2)",
              }}
              data-testid="button-toggle-theme"
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300"
                style={{
                  background: isDarkMode ? "var(--app-primary)" : "#2563eb",
                  left: isDarkMode ? "calc(100% - 1.375rem)" : "0.125rem",
                  boxShadow: isDarkMode
                    ? "0 0 8px rgba(var(--app-primary-rgb),0.6)"
                    : "0 0 6px rgba(37,99,235,0.4)",
                }}
              >
                {isDarkMode
                  ? <Moon size={10} color="white" />
                  : <Sun size={10} color="white" />}
              </div>
            </button>
          </div>
          <p className="text-[8px] text-foreground" style={{ color: "var(--app-sidebar-muted)", opacity: 0.6 }}>
            Switch between light and dark mode
          </p>
        </div>

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm transition-all duration-200"
          style={{
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.15)",
            color: isDarkMode ? "rgba(252,165,165,0.75)" : "rgba(185,28,28,0.8)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.14)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.28)";
            (e.currentTarget as HTMLButtonElement).style.color = isDarkMode ? "#fca5a5" : "#b91c1c";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.07)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.15)";
            (e.currentTarget as HTMLButtonElement).style.color = isDarkMode ? "rgba(252,165,165,0.75)" : "rgba(185,28,28,0.8)";
          }}
          data-testid="button-sign-out"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ── Mobile navigation system ───────────────────────────────────────────────
export function MobileNav({
  activeTab,
  setActiveTab,
  isDarkMode,
  toggleTheme,
  onSignOut,
  onRefresh,
  isOwner,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  isOwner: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  function navigate(id: string) {
    setActiveTab(id);
    setDrawerOpen(false);
  }

  const bottomTabs = [
    { id: "home",          label: "Home",   icon: LayoutDashboard },
    { id: "recent-trades", label: "Trades", icon: List },
    { id: "new-trade",     label: "Log",    icon: PlusCircle },
    { id: "trading-hub",   label: "Hub",    icon: Zap },
    { id: "performance",   label: "Stats",  icon: BarChart2 },
  ];

  const activeItem = [...NAV_MAIN, { id: "admin", label: "Admin Center", shortLabel: "Admin", icon: ShieldCheck }]
    .find((n) => n.id === activeTab);

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div
        className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-5 py-3 pt-[8px] pb-[8px] pl-[6px] pr-[6px] border-b-[0px]"
        style={{
          background: isDarkMode
            ? "rgba(6,10,20,0.82)"
            : "rgba(240,244,255,0.85)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderBottom: "1px solid var(--app-border)",
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-xl transition-all duration-200"
            style={{
              background: "var(--app-card)",
              border: "1px solid var(--app-border)",
              color: "var(--app-text)",
            }}
            data-testid="button-open-drawer"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <AccountSwitcher compact />
        </div>

        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-lg overflow-hidden"
            style={{ boxShadow: "0 0 8px rgba(var(--app-primary-rgb),0.4)" }}
          >
            <img src={LOGO_URL} alt="TradeEdge" className="w-full h-full object-cover" />
          </div>
          <span className="font-black text-sm tracking-tight" style={{ color: "var(--app-text)" }}>
            {activeItem?.label ?? "TradeEdge"}
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="p-2 rounded-xl transition-all duration-200"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            color: "var(--app-muted-color)",
          }}
          data-testid="button-refresh-mobile"
          aria-label="Refresh trades"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {/* ── Drawer ── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="lg:hidden fixed inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
              onClick={() => setDrawerOpen(false)}
            />

            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-72 flex flex-col overflow-hidden"
              style={{
                background: "var(--app-sidebar-bg)",
                borderRight: "1px solid var(--app-sidebar-border)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
              }}
            >
              {/* Drawer header */}
              <div
                className="flex items-center justify-between px-6 py-5 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--app-sidebar-border)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-xl overflow-hidden"
                    style={{ boxShadow: "0 0 12px rgba(var(--app-primary-rgb),0.5)" }}
                  >
                    <img src={LOGO_URL} alt="TradeEdge" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="font-black text-sm tracking-tight" style={{ color: "var(--app-sidebar-text)" }}>
                      Select2notion
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--app-sidebar-muted)" }}>
                      Trading Journal
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 rounded-xl transition-all"
                  style={{
                    background: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(37,99,235,0.06)",
                    border: isDarkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(37,99,235,0.12)",
                    color: isDarkMode ? "rgba(255,255,255,0.4)" : "#4a5680",
                  }}
                  data-testid="button-close-drawer"
                  aria-label="Close menu"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Nav list */}
              <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
                <p
                  className="text-[8px] font-black uppercase tracking-[0.22em] px-4 mb-3"
                  style={{ color: "var(--app-sidebar-muted)" }}
                >
                  Navigation
                </p>

                {NAV_MAIN.map((item, idx) => {
                  const isActive = activeTab === item.id;
                  return (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.035, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => navigate(item.id)}
                      className={`sidebar-link w-full ${isActive ? "sidebar-link-active" : ""}`}
                      data-testid={`drawer-nav-${item.id}`}
                    >
                      <item.icon size={19} />
                      <span className="tracking-tight">{item.label}</span>
                      {isActive && (
                        <motion.div
                          layoutId="drawer-active-dot"
                          className="ml-auto w-1.5 h-1.5 rounded-full"
                          style={{ background: "var(--app-primary)" }}
                        />
                      )}
                    </motion.button>
                  );
                })}

                {isOwner && (
                  <>
                    <p
                      className="text-[8px] font-black uppercase tracking-[0.22em] px-4 mb-3 mt-5"
                      style={{ color: "rgba(239,68,68,0.4)" }}
                    >
                      Owner Only
                    </p>
                    <motion.button
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: NAV_MAIN.length * 0.035 }}
                      onClick={() => navigate("admin")}
                      className={`sidebar-link w-full ${activeTab === "admin" ? "sidebar-link-active" : ""}`}
                      style={{ color: activeTab !== "admin" ? "rgba(252,165,165,0.7)" : undefined }}
                      data-testid="drawer-nav-admin"
                    >
                      <ShieldCheck size={19} />
                      <span className="tracking-tight">Admin Center</span>
                    </motion.button>
                  </>
                )}
              </nav>

              {/* Bottom */}
              <div
                className="p-5 space-y-3 flex-shrink-0"
                style={{ borderTop: "1px solid var(--app-sidebar-border)" }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-2xl"
                  style={{
                    background: isDarkMode ? "rgba(255,255,255,0.03)" : "rgba(37,99,235,0.04)",
                    border: isDarkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(37,99,235,0.1)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    {isDarkMode
                      ? <Moon size={16} style={{ color: "var(--app-primary)" }} />
                      : <Sun size={16} style={{ color: "var(--app-primary)" }} />}
                    <span className="text-sm font-bold" style={{ color: "var(--app-sidebar-text)" }}>
                      {isDarkMode ? "Dark Mode" : "Light Mode"}
                    </span>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className="w-11 h-6 rounded-full relative transition-all duration-300 flex-shrink-0"
                    style={{
                      background: isDarkMode
                        ? "rgba(var(--app-primary-rgb),0.4)"
                        : "rgba(37,99,235,0.15)",
                      border: isDarkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(37,99,235,0.2)",
                      boxShadow: isDarkMode ? "0 0 10px rgba(var(--app-primary-rgb),0.35)" : "0 0 8px rgba(37,99,235,0.2)",
                    }}
                    data-testid="button-toggle-theme-mobile"
                    aria-label="Toggle theme"
                  >
                    <div
                      className="absolute top-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300"
                      style={{
                        background: isDarkMode ? "var(--app-primary)" : "#2563eb",
                        left: isDarkMode ? "calc(100% - 1.375rem)" : "0.125rem",
                        boxShadow: isDarkMode
                          ? "0 0 8px rgba(var(--app-primary-rgb),0.6)"
                          : "0 0 6px rgba(37,99,235,0.4)",
                      }}
                    >
                      {isDarkMode
                        ? <Moon size={10} color="white" />
                        : <Sun size={10} color="white" />}
                    </div>
                  </button>
                </div>

                <button
                  onClick={() => { setDrawerOpen(false); onSignOut(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-200"
                  style={{
                    background: "rgba(239,68,68,0.07)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    color: isDarkMode ? "rgba(252,165,165,0.75)" : "rgba(185,28,28,0.8)",
                  }}
                  data-testid="button-sign-out-mobile"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
