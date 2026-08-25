import { useCallback, useEffect, useState, useMemo, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Bell, RefreshCw } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import Dashboard from "./components/Dashboard";
import TradeForm from "./components/TradeForm";
import Home from "./components/Home";
import Performance from "./components/Performance";
import PnLCalendar from "./components/PnLCalendar";
import Settings from "./components/Settings";
import AIAgent from "./components/AIAgent";
import RecentTrades from "./components/RecentTrades";
import NewsDashboard from "./components/NewsDashboard";
import TradingHub from "./components/TradingHub";
import AccountSwitcher from "./components/AccountSwitcher";
import { Sidebar, MobileNav } from "./components/Layout";
import { useGetTrades, getGetTradesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./hooks/useAuth";
import LoginPage from "./pages/LoginPage";
import NoAccessPage from "./pages/NoAccessPage";
import AdminPanel from "./pages/AdminPanel";
import ConnectNotion from "./pages/ConnectNotion";
import { AccountProvider, useAccount } from "./context/AccountContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  },
});

const ACCOUNT_PROPERTY_NAMES = ["Trading Account", "Account", "trading account", "account"];

function getTradeAccount(trade: any): string | null {
  for (const k of ACCOUNT_PROPERTY_NAMES) {
    if (trade[k]) return String(trade[k]);
  }
  return null;
}

// Depth zoom-fade transition — enter scales up from dark, exit scales down to dark
const pageVariants = {
  enter: {
    opacity: 0,
    scale: 0.96,
    y: 14,
    filter: "blur(6px)",
  },
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: "blur(0px)",
  },
  exit: {
    opacity: 0,
    scale: 1.02,
    y: -8,
    filter: "blur(4px)",
  },
};

const pageTransition = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

function AppContent({ isOwner, onSettingsTab }: { isOwner: boolean; onSettingsTab?: boolean }) {
  const [activeTab, setActiveTab] = useState(onSettingsTab ? "settings" : "home");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const qClient = useQueryClient();
  const { selectedAccount } = useAccount();

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved ? saved === "dark" : prefersDark;
    setIsDarkMode(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const { data: tradesData, isLoading, error } = useGetTrades();
  const allTrades: any[] = useMemo(() => {
    const raw: any[] = tradesData?.trades || [];
    const seen = new Set<string>();
    return raw.filter((t) => {
      const id = String(t?.id ?? "");
      if (!id || seen.has(id)) return !id;
      seen.add(id);
      return true;
    });
  }, [tradesData]);

  const trades = useMemo(() => {
    if (!selectedAccount) return allTrades;
    return allTrades.filter((t) => getTradeAccount(t) === selectedAccount);
  }, [allTrades, selectedAccount]);

  const handleRefresh = () => {
    qClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
  };

  const navigateTo = useCallback((next: string) => {
    setActiveTab(next);
  }, []);

  const tabs: Record<string, ReactElement> = {
    home: <Home trades={trades} setActiveTab={navigateTo} isDarkMode={isDarkMode} />,
    dashboard: <Dashboard trades={trades} isDarkMode={isDarkMode} />,
    "recent-trades": <RecentTrades trades={allTrades} />,
    "new-trade": <TradeForm onTradeCreated={() => navigateTo("recent-trades")} />,
    performance: <Performance trades={trades} isDarkMode={isDarkMode} />,
    "trading-hub": <TradingHub trades={allTrades} />,
    calendar: (
      <div className="space-y-6">
        <header>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
            P&L Calendar
          </h2>
          <p className="font-medium text-sm mt-1" style={{ color: "var(--app-muted-color)" }}>
            Your daily performance at a glance.
          </p>
        </header>
        <PnLCalendar trades={trades} />
      </div>
    ),
    "ai-reflection": <AIAgent onGoToSettings={() => navigateTo("settings")} />,
    news: <NewsDashboard />,
    settings: <Settings />,
    ...(isOwner ? { admin: <AdminPanel /> } : {}),
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--app-bg)" }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={navigateTo}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        onSignOut={() => signOut(auth)}
        isOwner={isOwner}
      />
      <main className="lg:pl-72 min-h-screen">
        <MobileNav
          activeTab={activeTab}
          setActiveTab={navigateTo}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          onSignOut={() => signOut(auth)}
          onRefresh={handleRefresh}
          isOwner={isOwner}
        />


        <div
          className="hidden lg:flex sticky top-0 z-30 px-10 py-4 items-center justify-between bg-[#060a1400]"
          style={{
            background: "color-mix(in srgb, var(--app-bg) 80%, transparent)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--app-border)",
          }}
        >
          {/* Account Switcher — left side of header */}
          <AccountSwitcher />

          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              className="p-2.5 rounded-xl transition-all"
              style={{
                background: "var(--app-card)",
                border: "1px solid var(--app-border)",
                color: "var(--app-muted-color)",
              }}
              title="Refresh trades"
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="p-2.5 rounded-xl transition-all"
              style={{
                background: "var(--app-card)",
                border: "1px solid var(--app-border)",
                color: "var(--app-muted-color)",
              }}
            >
              <Bell size={18} />
            </button>
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center font-black text-sm"
              style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
            >
              T
            </div>
          </div>
        </div>

        <div className="px-6 md:px-10 py-8 pb-6 lg:pb-10 text-left bg-background mt-[0px] mb-[0px] ml-[0px] mr-[0px]">
          {isLoading && (
            <div
              className="flex items-center gap-3 mb-6 px-5 py-4 rounded-2xl text-sm font-medium"
              style={{
                background: "color-mix(in srgb, var(--app-primary) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-primary) 10%, transparent)",
                color: "var(--app-primary)",
              }}
            >
              <Loader2 size={16} className="animate-spin" />
              Loading your trades from Notion...
            </div>
          )}

          {error && !isLoading && (
            <div
              className="flex items-center gap-3 mb-6 px-5 py-4 rounded-2xl text-sm font-medium"
              style={{
                background: "color-mix(in srgb, var(--app-danger) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-danger) 10%, transparent)",
                color: "var(--app-danger)",
              }}
            >
              Could not load trades. Check your Notion connection in Settings.
              <button
                onClick={() => navigateTo("settings")}
                className="ml-auto text-[10px] font-black uppercase tracking-widest underline"
              >
                Settings
              </button>
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {activeTab === "ai-reflection" ? (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {tabs[activeTab]}
              </motion.div>
            ) : (
              <motion.div
                key={activeTab}
                variants={pageVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={pageTransition}
                style={{ willChange: "opacity, transform, filter" }}
              >
                {tabs[activeTab] || tabs["home"]}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function AuthGuard() {
  const { user, status, isOwner, notionConnected, refetchNotionStatus } = useAuth();

  if (status === "loading" || (status === "approved" && notionConnected === null)) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--app-bg)" }}
      >
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--app-primary)" }} />
      </div>
    );
  }

  if (status === "unauthenticated") return <LoginPage />;
  if (status === "no-access") return <NoAccessPage user={user!} />;

  if (status === "approved" && notionConnected === false) {
    return <ConnectNotion user={user!} onConnected={refetchNotionStatus} />;
  }

  return <AppContent isOwner={isOwner} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <AuthGuard />
      </AccountProvider>
    </QueryClientProvider>
  );
}

export default App;
