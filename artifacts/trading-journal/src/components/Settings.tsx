import { useState, useEffect, useCallback, useRef } from "react";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import {
  Loader2, CheckCircle, XCircle, AlertTriangle, AlertCircle,
  RefreshCw, Link2Off, Clock, Shield, Activity, ArrowRight,
  Bell, Key, Sparkles, Eye, EyeOff, ChevronDown, ChevronUp,
  WifiOff, Database, Zap, Brain, Cpu, Send, Link, Unlink, ExternalLink, Server,
} from "lucide-react";
import { auth, db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import {
  useGetNotificationSettings,
  useSaveNotificationSettings,
  useTestNotionConnection,
  useTriggerDailyReminder,
  useTriggerWeeklyReport,
} from "@workspace/api-client-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type HealthStatus =
  | "checking"
  | "healthy"
  | "partial_permissions"
  | "invalid_token"
  | "database_not_shared"
  | "sync_delayed"
  | "database_not_found"
  | "disconnected";

type ReplaceStep = "idle" | "testing" | "validating" | "replacing" | "syncing" | "done" | "error";

interface WakeupStatus {
  serverStatus: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
  uptimeSeconds: number;
  uptimeHuman: string;
  memoryMB: number;
  memoryRssMB: number;
  internalPingCount: number;
  lastInternalPing: string | null;
  externalPingCount: number;
  lastExternalPing: string | null;
  lastExternalResponseMs: number | null;
  lastWebhookReceived: string | null;
  webhookUpdateCount: number;
  lastSuccessfulPing: string | null;
  lastError: string | null;
  externalPingerConfigured: boolean;
  externalPingerHint: string | null;
}

interface TimelineEvent { id: string; date: string; label: string; icon: string; }
interface ConnectionInfo { autoDetected: boolean; connectedAt: Date | null; dbId: string; }

// ─── Health Config ───────────────────────────────────────────────────────────

const HEALTH: Record<HealthStatus, {
  dot: string; label: string; color: string; bg: string; border: string;
  emoji: string; explanation: string; action: string;
}> = {
  checking:            { dot: "#94A3B8", label: "Checking...",         color: "var(--app-muted-color)", bg: "color-mix(in srgb,var(--app-muted-color) 8%,transparent)", border: "color-mix(in srgb,var(--app-muted-color) 15%,transparent)", emoji: "⟳",   explanation: "Running live connection health check…",                            action: "" },
  healthy:             { dot: "#22C55E", label: "Healthy",             color: "var(--app-success)",     bg: "color-mix(in srgb,var(--app-success) 8%,transparent)",     border: "color-mix(in srgb,var(--app-success) 20%,transparent)",     emoji: "🟢",  explanation: "Your Notion database is connected and syncing normally.",         action: "" },
  partial_permissions: { dot: "#EAB308", label: "Partial Permissions", color: "#EAB308",                bg: "color-mix(in srgb,#EAB308 8%,transparent)",                 border: "color-mix(in srgb,#EAB308 20%,transparent)",                emoji: "🟡",  explanation: "Some database permissions are restricted.",                       action: "Review integration capabilities in Notion settings." },
  invalid_token:       { dot: "#EF4444", label: "Invalid Token",       color: "var(--app-danger)",      bg: "color-mix(in srgb,var(--app-danger) 8%,transparent)",       border: "color-mix(in srgb,var(--app-danger) 20%,transparent)",      emoji: "🔴",  explanation: "Your Notion token is invalid or has expired.",                    action: "Generate a new token at notion.so/my-integrations." },
  database_not_shared: { dot: "#F59E0B", label: "Database Not Shared", color: "#F59E0B",                bg: "color-mix(in srgb,#F59E0B 8%,transparent)",                 border: "color-mix(in srgb,#F59E0B 20%,transparent)",                emoji: "⚠️",  explanation: "Database access permissions are missing. Please share your database with the connected integration.", action: "Open Notion → share the database with your integration." },
  sync_delayed:        { dot: "#F97316", label: "Sync Delayed",        color: "#F97316",                bg: "color-mix(in srgb,#F97316 8%,transparent)",                 border: "color-mix(in srgb,#F97316 20%,transparent)",                emoji: "🟠",  explanation: "Connection is slow or the Notion API is temporarily unreachable.", action: "Check your network or try revalidating in a moment." },
  database_not_found:  { dot: "#EF4444", label: "Database Not Found",  color: "var(--app-danger)",      bg: "color-mix(in srgb,var(--app-danger) 8%,transparent)",       border: "color-mix(in srgb,var(--app-danger) 20%,transparent)",      emoji: "🔴",  explanation: "The connected database no longer exists or was moved.",            action: "Replace connection using the panel below." },
  disconnected:        { dot: "#94A3B8", label: "Not Connected",       color: "var(--app-muted-color)", bg: "color-mix(in srgb,var(--app-muted-color) 8%,transparent)", border: "color-mix(in srgb,var(--app-muted-color) 15%,transparent)", emoji: "⬜",  explanation: "No Notion database is connected.",                                action: "Connect a database to get started." },
};

const REPLACE_LABELS: Record<ReplaceStep, string> = {
  idle:       "",
  testing:    "Testing connection…",
  validating: "Validating database…",
  replacing:  "Replacing active connection…",
  syncing:    "Syncing new database…",
  done:       "",
  error:      "",
};

function maskToken(token: string) {
  if (!token) return "—";
  return token.slice(0, 6) + "••••••••••••";
}

function maskDbId(id: string) {
  if (!id) return "—";
  const clean = id.replace(/-/g, "");
  return clean.slice(0, 8) + "…" + clean.slice(-4);
}

function formatDate(d: Date | null) {
  if (!d) return "Unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timelineKey(uid: string) { return `te_timeline_${uid}`; }

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Settings() {
  const { user, notionConnected, refetchNotionStatus, disconnectNotion } = useAuth();

  // Health
  const [health, setHealth] = useState<HealthStatus>("disconnected");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Connection info
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);

  // Replace panel
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [newDbId, setNewDbId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [replaceStep, setReplaceStep] = useState<ReplaceStep>("idle");
  const [replaceError, setReplaceError] = useState("");

  // Timeline
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  // Notification
  const [email, setEmail] = useState("");
  const [notifType, setNotifType] = useState<"off" | "daily" | "weekly">("off");
  const [saveMsg, setSaveMsg] = useState("");

  const [wakeupStatus, setWakeupStatus] = useState<WakeupStatus | null>(null);
  const [wakeupLoading, setWakeupLoading] = useState(true);

  const { data: notifSettings } = useGetNotificationSettings();
  const testNotion = useTestNotionConnection();
  const saveSettings = useSaveNotificationSettings();
  const triggerDaily = useTriggerDailyReminder();
  const triggerWeekly = useTriggerWeeklyReport();

  useEffect(() => {
    if (notifSettings) {
      setEmail(notifSettings.email || "");
      setNotifType((notifSettings.type as any) || "off");
    }
  }, [notifSettings]);

  // Server wakeup status
  useEffect(() => {
    async function fetchWakeup() {
      try {
        const res = await fetch("/api/wakeup/status");
        if (res.ok) setWakeupStatus(await res.json());
      } catch { /* ignore */ } finally {
        setWakeupLoading(false);
      }
    }
    fetchWakeup();
    const id = setInterval(fetchWakeup, 60_000);
    return () => clearInterval(id);
  }, []);

  // Load connection info from Firestore
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "user_connections", user.uid)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setConnInfo({
          autoDetected: data.workspace_auto_detected === true,
          connectedAt: data.connected_at?.toDate?.() || null,
          dbId: data.notion_database_id || "",
        });
      } else {
        setConnInfo(null);
      }
    }).catch(() => setConnInfo(null));
  }, [user, notionConnected]);

  // Load timeline from localStorage
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(timelineKey(user.uid));
      if (raw) setTimeline(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [user]);

  const pushEvent = useCallback((label: string, icon: string) => {
    if (!user) return;
    const event: TimelineEvent = {
      id: String(Date.now()),
      date: new Date().toISOString(),
      label,
      icon,
    };
    setTimeline((prev) => {
      const next = [event, ...prev].slice(0, 8);
      try { localStorage.setItem(timelineKey(user.uid), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [user]);

  // ── Health check ──────────────────────────────────────────────────────────

  const runHealthCheck = useCallback(async () => {
    if (!notionConnected) { setHealth("disconnected"); return; }
    setHealth("checking");
    try {
      const token = await auth.currentUser?.getIdToken();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch("/api/notion/schema", {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) setHealth("healthy");
      else if (resp.status === 401) setHealth("invalid_token");
      else if (resp.status === 403) setHealth("database_not_shared");
      else if (resp.status === 404) setHealth("database_not_found");
      else setHealth("sync_delayed");
      setLastChecked(new Date());
    } catch (err: any) {
      if (err.name === "AbortError") setHealth("sync_delayed");
      else setHealth("sync_delayed");
      setLastChecked(new Date());
    }
  }, [notionConnected]);

  useEffect(() => {
    if (notionConnected === true) runHealthCheck();
    else if (notionConnected === false) setHealth("disconnected");
  }, [notionConnected]);

  // ── Disconnect ────────────────────────────────────────────────────────────

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Notion? Your trade data in Notion won't be deleted.")) return;
    pushEvent("Connection Disconnected", "🔴");
    await disconnectNotion();
    setHealth("disconnected");
    setConnInfo(null);
  };

  // ── Replace connection ────────────────────────────────────────────────────

  const handleReplace = async () => {
    if (!user || !newToken.trim() || !newDbId.trim()) return;
    setReplaceError("");
    setReplaceStep("testing");

    try {
      // Step 1: Test
      await new Promise<void>((resolve, reject) => {
        testNotion.mutate(
          { data: { apiKey: newToken.trim(), databaseId: newDbId.trim() } },
          {
            onSuccess: (data) => data.status === "OK" ? resolve() : reject(new Error(data.message)),
            onError: () => reject(new Error("Connection test failed")),
          },
        );
      });

      // Step 2: Validate (brief visual pause)
      setReplaceStep("validating");
      await new Promise((r) => setTimeout(r, 800));

      // Step 3: Replace
      setReplaceStep("replacing");
      await setDoc(doc(db, "user_connections", user.uid), {
        notion_token: newToken.trim(),
        notion_database_id: newDbId.trim(),
        connected_at: serverTimestamp(),
        workspace_auto_detected: false,
      });

      // Step 4: Sync
      setReplaceStep("syncing");
      await refetchNotionStatus();
      await new Promise((r) => setTimeout(r, 600));

      setReplaceStep("done");
      setNewToken("");
      setNewDbId("");
      pushEvent("Database Replaced Successfully", "🔄");
      pushEvent("Previous Connection Deactivated", "⬜");

      // Auto-reset after 3s
      setTimeout(() => {
        setReplaceStep("idle");
        setReplaceOpen(false);
        runHealthCheck();
      }, 3000);

    } catch (err: any) {
      setReplaceError(err.message || "Replacement failed. Check credentials.");
      setReplaceStep("error");
    }
  };

  const handleSaveNotif = () => {
    saveSettings.mutate(
      { data: { email, type: notifType } },
      {
        onSuccess: () => { setSaveMsg("Settings saved!"); setTimeout(() => setSaveMsg(""), 3000); },
      },
    );
  };

  const h = HEALTH[health];
  const isReplacing = ["testing", "validating", "replacing", "syncing"].includes(replaceStep);
  const canReplace = newToken.trim().length > 5 && newDbId.trim().length > 5 && !isReplacing && replaceStep !== "done";

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ── Page Header ── */}
      <header>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={14} style={{ color: "var(--app-primary)" }} />
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>
            Connection Intelligence
          </span>
        </div>
        <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>Settings</h2>
        <p className="font-medium text-sm mt-1" style={{ color: "var(--app-muted-color)" }}>
          Manage your Notion workspace, connection health, and notification preferences.
        </p>
      </header>
      {/* ── Health Monitoring Panel ── */}
      <section className="glass-card overflow-hidden">
        {/* Gradient top bar */}
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, var(--app-primary), ${h.dot})` }} />

        <div className="p-8 space-y-6">
          {/* Title + status badge */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl" style={{ background: h.bg, color: h.color }}>
                <Activity size={20} />
              </div>
              <div>
                <h3 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Live Connection Status</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString()}` : "Not yet checked"}
                </p>
              </div>
            </div>

            {/* Animated status badge */}
            <div
              className="flex items-center gap-2.5 px-4 py-2 rounded-full font-black text-sm transition-all duration-500"
              style={{ background: h.bg, border: `1px solid ${h.border}`, color: h.color }}
            >
              {health === "checking" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    background: h.dot,
                    boxShadow: health === "healthy" ? `0 0 8px ${h.dot}` : "none",
                    animation: health !== "disconnected" ? "pulse 2s infinite" : "none",
                  }}
                />
              )}
              {h.label}
            </div>
          </div>

          {/* Explanation + Action */}
          <div
            className="p-5 rounded-2xl space-y-2"
            style={{ background: h.bg, border: `1px solid ${h.border}` }}
          >
            <p className="text-sm font-semibold" style={{ color: h.color }}>{h.explanation}</p>
            {h.action && (
              <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>→ {h.action}</p>
            )}
          </div>

          {/* Connection metadata */}
          {notionConnected && connInfo && (
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Connection Type",
                  value: connInfo.autoDetected ? "Auto (OAuth)" : "Manual",
                  icon: connInfo.autoDetected ? <Zap size={13} /> : <Key size={13} />,
                  accent: connInfo.autoDetected ? "var(--app-primary)" : "var(--app-secondary)",
                },
                {
                  label: "Connected",
                  value: formatDate(connInfo.connectedAt),
                  icon: <Clock size={13} />,
                  accent: "var(--app-muted-color)",
                },
                {
                  label: "Database",
                  value: maskDbId(connInfo.dbId),
                  icon: <Database size={13} />,
                  accent: "var(--app-muted-color)",
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="p-4 rounded-2xl space-y-2 pl-[7px] pr-[7px] text-left pt-[30px] pb-[30px] font-thin ml-[-4px] mr-[-4px]"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}
                >
                  <div className="flex items-center gap-1.5" style={{ color: m.accent }}>
                    {m.icon}
                    <span className="text-[9px] font-black uppercase tracking-widest ml-[-14px] mr-[-14px] pl-[9px] pr-[9px]">{m.label}</span>
                  </div>
                  <p className="text-xs font-black font-mono" style={{ color: "var(--app-text)" }}>{m.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={runHealthCheck}
              disabled={health === "checking" || !notionConnected}
              className="btn-ghost-primary ml-[-1px] mr-[-1px] pl-[43px] pr-[43px]"
            >
              {health === "checking" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Revalidate
            </button>

            <button
              onClick={() => { setReplaceOpen((o) => !o); }}
              disabled={!notionConnected}
              className="btn-ghost-secondary ml-[0px] mr-[0px] pl-[10px] pr-[10px]"
            >
              <Database size={13} />
              {replaceOpen ? "Hide Replace" : "Replace Database"}
              {replaceOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {notionConnected && (
              <button
                onClick={handleDisconnect}
                className="btn-ghost-danger ml-[0px] pl-[41px] pr-[41px]"
              >
                <Link2Off size={13} />
                Disconnect
              </button>
            )}
          </div>

          {/* Not connected empty state */}
          {!notionConnected && (
            <div className="flex items-center gap-3 px-5 py-4 rounded-2xl"
              style={{ background: "color-mix(in srgb,var(--app-muted-color) 6%,transparent)", border: "1px dashed var(--app-border)" }}>
              <WifiOff size={18} style={{ color: "var(--app-muted-color)" }} />
              <div>
                <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>No active connection</p>
                <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>Connect your Notion workspace from the Connect page.</p>
              </div>
            </div>
          )}
        </div>
      </section>
      {/* ── Replace Connection Panel ── */}
      {replaceOpen && (
        <section className="glass-card p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl" style={{ background: "color-mix(in srgb,var(--app-secondary) 10%,transparent)", color: "var(--app-secondary)" }}>
              <Database size={20} />
            </div>
            <div>
              <h3 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Replace Connection</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                Swap database · previous connection deactivated automatically
              </p>
            </div>
          </div>

          {/* Success state */}
          {replaceStep === "done" && (
            <div className="p-6 rounded-2xl text-center space-y-2"
              style={{ background: "color-mix(in srgb,var(--app-success) 8%,transparent)", border: "1px solid color-mix(in srgb,var(--app-success) 20%,transparent)" }}>
              <CheckCircle size={28} className="mx-auto" style={{ color: "var(--app-success)" }} />
              <p className="font-black text-base" style={{ color: "var(--app-success)" }}>New Notion database connected successfully.</p>
              <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>Previous database connection has been safely replaced.</p>
            </div>
          )}

          {/* Form */}
          {replaceStep !== "done" && (
            <div className="space-y-4">
              {/* New token */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
                  New Integration Token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    placeholder="ntn_..."
                    value={newToken}
                    onChange={(e) => { setNewToken(e.target.value); setReplaceStep("idle"); setReplaceError(""); }}
                    className="input-field pr-10"
                    disabled={isReplacing}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                    style={{ color: "var(--app-muted-color)" }}
                  >
                    {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* New DB ID */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
                  New Database ID
                </label>
                <input
                  type="text"
                  placeholder="d06645f1…"
                  value={newDbId}
                  onChange={(e) => { setNewDbId(e.target.value); setReplaceStep("idle"); setReplaceError(""); }}
                  className="input-field"
                  disabled={isReplacing}
                />
              </div>

              {/* Progress steps */}
              {isReplacing && (
                <div className="space-y-3">
                  {(["testing", "validating", "replacing", "syncing"] as ReplaceStep[]).map((step, i) => {
                    const steps: ReplaceStep[] = ["testing", "validating", "replacing", "syncing"];
                    const currentIdx = steps.indexOf(replaceStep as ReplaceStep);
                    const stepIdx = steps.indexOf(step);
                    const isDone = stepIdx < currentIdx;
                    const isActive = stepIdx === currentIdx;
                    return (
                      <div key={step} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
                          style={{
                            background: isDone ? "var(--app-success)" : isActive ? "var(--app-primary)" : "var(--app-border)",
                          }}>
                          {isDone ? <CheckCircle size={12} color="#fff" /> : isActive ? <Loader2 size={12} color="#fff" className="animate-spin" /> : null}
                        </div>
                        <span className="text-xs font-semibold" style={{ color: isDone || isActive ? "var(--app-text)" : "var(--app-muted-color)" }}>
                          {REPLACE_LABELS[step]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Error */}
              {replaceStep === "error" && replaceError && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "color-mix(in srgb,var(--app-danger) 8%,transparent)", border: "1px solid color-mix(in srgb,var(--app-danger) 15%,transparent)" }}>
                  <XCircle size={15} className="shrink-0 mt-0.5" style={{ color: "var(--app-danger)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--app-danger)" }}>{replaceError}</span>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleReplace}
                  disabled={!canReplace}
                  className="btn-primary flex-1"
                >
                  {isReplacing ? (
                    <><Loader2 size={16} className="animate-spin" />{REPLACE_LABELS[replaceStep]}</>
                  ) : replaceStep === "error" ? (
                    <><RefreshCw size={16} />Retry Replace</>
                  ) : (
                    <><ArrowRight size={16} />Update &amp; Replace Database</>
                  )}
                </button>
              </div>

              <p className="text-[10px] font-medium text-center" style={{ color: "var(--app-muted-color)" }}>
                The previous connection is deactivated instantly. Only one active database at a time.
              </p>
            </div>
          )}
        </section>
      )}
      {/* ── Connection Timeline ── */}
      {(timeline.length > 0 || notionConnected) && (
        <section className="glass-card p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl"
              style={{ background: "color-mix(in srgb,var(--app-primary) 10%,transparent)", color: "var(--app-primary)" }}>
              <Clock size={20} />
            </div>
            <div>
              <h3 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Connection Timeline</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Recent events</p>
            </div>
          </div>

          {timeline.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>No events recorded yet. Activity will appear here after connection actions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {timeline.map((ev, i) => (
                <div key={ev.id} className="flex items-start gap-4">
                  {/* Dot + line */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                      style={{ background: "var(--app-bg)", border: "2px solid var(--app-border)" }}>
                      {ev.icon}
                    </div>
                    {i < timeline.length - 1 && (
                      <div className="w-0.5 h-6 mt-1" style={{ background: "var(--app-border)" }} />
                    )}
                  </div>
                  <div className="pb-2">
                    <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>{ev.label}</p>
                    <p className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
                      {new Date(ev.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" — "}
                      {new Date(ev.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {/* ── Email Notifications ── */}
      <section className="glass-card p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl"
            style={{ background: "color-mix(in srgb,var(--app-secondary) 10%,transparent)", color: "var(--app-secondary)" }}>
            <Bell size={20} />
          </div>
          <div>
            <h3 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Email Notifications</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
              Reminders &amp; reports
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
              Email Address
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-3 block" style={{ color: "var(--app-muted-color)" }}>
              Notification Schedule
            </label>
            <div className="flex gap-3">
              {(["off", "daily", "weekly"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setNotifType(type)}
                  className="flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: notifType === type ? "var(--app-primary)" : "var(--app-card)",
                    border: `1px solid ${notifType === type ? "var(--app-primary)" : "var(--app-border)"}`,
                    color: notifType === type ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                    boxShadow: notifType === type ? "0 10px 15px -3px color-mix(in srgb,var(--app-primary) 20%,transparent)" : "none",
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {saveMsg && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: "color-mix(in srgb,var(--app-success) 10%,transparent)", color: "var(--app-success)" }}>
              <CheckCircle size={16} />
              {saveMsg}
            </div>
          )}

          <button onClick={handleSaveNotif} disabled={saveSettings.isPending || !email} className="btn-primary text-[15px] ml-[6px] mr-[6px] mt-[5px] mb-[5px] pt-[6px] pb-[6px] pl-[11px] pr-[11px] rounded-tl-[8px] rounded-tr-[8px] rounded-br-[8px] rounded-bl-[8px]">
            {saveSettings.isPending ? <><Loader2 className="animate-spin" size={18} />Saving…</> : "Save Settings"}
          </button>
        </div>

        <div className="pt-6" style={{ borderTop: "1px solid var(--app-border)" }}>
          <h4 className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>
            Diagnostic Tools
          </h4>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => triggerDaily.mutate()} disabled={triggerDaily.isPending} className="btn-outline text-xs text-background pl-[12px] pr-[12px] rounded-tl-[4px] rounded-tr-[4px] rounded-br-[4px] rounded-bl-[4px]">
              {triggerDaily.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Test Daily Logic
            </button>
            <button onClick={() => triggerWeekly.mutate()} disabled={triggerWeekly.isPending} className="btn-outline text-xs text-background rounded-tl-[4px] rounded-tr-[4px] rounded-br-[4px] rounded-bl-[4px] pl-[15px] pr-[15px]">
              {triggerWeekly.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Test Weekly Logic
            </button>
          </div>
          <p className="mt-3 text-[9px] font-medium italic" style={{ color: "var(--app-muted-color)" }}>
            * These trigger notification logic immediately for the saved email.
          </p>
        </div>
      </section>
      {/* ── AI Provider Section ─────────────────────────────────────────── */}
      <AIProviderSection />
      {/* ── Telegram Section ─────────────────────────────────────────────── */}
      <TelegramSection />
      {/* ── Server Wakeup Monitor ────────────────────────────────────────── */}
      <section className="glass-card p-8 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="p-2.5 rounded-xl"
            style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
            <Server size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Server Health Monitor</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
              Auto-pings every 5 minutes to keep the server alive
            </p>
          </div>
          {wakeupStatus && (
            <div className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex-shrink-0"
              style={{
                background: wakeupStatus.serverStatus === "ONLINE"
                  ? "color-mix(in srgb, var(--app-success) 12%, transparent)"
                  : wakeupStatus.serverStatus === "DEGRADED"
                  ? "color-mix(in srgb, #F59E0B 12%, transparent)"
                  : "color-mix(in srgb, var(--app-danger) 12%, transparent)",
                color: wakeupStatus.serverStatus === "ONLINE"
                  ? "var(--app-success)"
                  : wakeupStatus.serverStatus === "DEGRADED"
                  ? "#F59E0B"
                  : wakeupStatus.serverStatus === "OFFLINE"
                  ? "var(--app-danger)"
                  : "var(--app-muted-color)",
              }}>
              {wakeupStatus.serverStatus === "ONLINE" ? "🟢 Online"
                : wakeupStatus.serverStatus === "DEGRADED" ? "🟡 Degraded"
                : wakeupStatus.serverStatus === "OFFLINE" ? "🔴 Offline"
                : "⬜ Unknown"}
            </div>
          )}
        </div>

        {wakeupLoading ? (
          <div className="flex items-center gap-2" style={{ color: "var(--app-muted-color)" }}>
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm font-medium">Loading server status…</span>
          </div>
        ) : wakeupStatus ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Uptime", value: wakeupStatus.uptimeHuman ?? "—" },
                { label: "Memory", value: wakeupStatus.memoryMB != null ? `${wakeupStatus.memoryMB} MB` : "—" },
                { label: "Last External Ping", value: wakeupStatus.lastExternalPing ? new Date(wakeupStatus.lastExternalPing).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—" },
                { label: "External Pings", value: wakeupStatus.externalPingCount != null ? String(wakeupStatus.externalPingCount) : "—" },
                { label: "Last Webhook", value: wakeupStatus.lastWebhookReceived ? new Date(wakeupStatus.lastWebhookReceived).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—" },
                { label: "Webhook Updates", value: wakeupStatus.webhookUpdateCount != null ? String(wakeupStatus.webhookUpdateCount) : "—" },
                { label: "Last Successful Ping", value: wakeupStatus.lastSuccessfulPing ? new Date(wakeupStatus.lastSuccessfulPing).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—" },
                { label: "Last Ext Response", value: wakeupStatus.lastExternalResponseMs != null ? `${wakeupStatus.lastExternalResponseMs} ms` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3 rounded-2xl"
                  style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--app-muted-color)" }}>{label}</p>
                  <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>{value}</p>
                </div>
              ))}
            </div>
            {wakeupStatus.externalPingerHint && (
              <p className="text-xs font-medium px-3 py-2 rounded-xl mt-1"
                style={{
                  background: "color-mix(in srgb, #F59E0B 8%, transparent)",
                  color: "#F59E0B",
                  border: "1px solid color-mix(in srgb, #F59E0B 15%, transparent)",
                }}>
                ⚠️ {wakeupStatus.externalPingerHint}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
            Server status unavailable. The server may still be warming up — check back in a moment.
          </p>
        )}

        {wakeupStatus?.lastError && (
          <p className="text-xs font-medium px-3 py-2 rounded-xl"
            style={{
              background: "color-mix(in srgb, var(--app-danger) 8%, transparent)",
              color: "var(--app-danger)",
              border: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)",
            }}>
            Last error: {wakeupStatus.lastError}
          </p>
        )}
      </section>
      {/* Pulse keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// ─── AI Provider Section ─────────────────────────────────────────────────────

type AiStatus = "idle" | "testing" | "connected" | "invalid_key" | "timeout" | "rate_limited" | "error";

const AI_STATUS_META: Record<AiStatus, { label: string; color: string; dot: string }> = {
  idle:        { label: "Disconnected",  color: "var(--app-muted-color)", dot: "#94A3B8" },
  testing:     { label: "Testing…",     color: "#F59E0B",                dot: "#F59E0B" },
  connected:   { label: "Connected",    color: "var(--app-success)",     dot: "#22C55E" },
  invalid_key: { label: "Invalid Key",  color: "var(--app-danger)",      dot: "#EF4444" },
  timeout:     { label: "Timeout",      color: "#F97316",                dot: "#F97316" },
  rate_limited:{ label: "Rate Limited", color: "#EAB308",                dot: "#EAB308" },
  error:       { label: "Error",        color: "var(--app-danger)",      dot: "#EF4444" },
};

interface AiModel { id: string; displayName: string }

function ModelSelector({
  provider, apiKey, selectedModel, onSelect,
}: {
  provider: string;
  apiKey: string;
  selectedModel: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!apiKey.trim()) {
      const defaults: AiModel[] = provider === "gemini"
        ? [
            { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
            { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
            { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
            { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
          ]
        : [
            { id: "gpt-4o", displayName: "GPT-4o" },
            { id: "gpt-4o-mini", displayName: "GPT-4o Mini" },
            { id: "gpt-4-turbo", displayName: "GPT-4 Turbo" },
          ];
      setModels(defaults);
      return;
    }

    setLoading(true);
    auth.currentUser?.getIdToken().then(async (token) => {
      try {
        const resp = await fetch("/api/ai/models", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const data = (await resp.json()) as { models: AiModel[] };
          if (data.models?.length) setModels(data.models);
        }
      } catch { /* keep defaults */ } finally { setLoading(false); }
    }).catch(() => setLoading(false));
  }, [apiKey, provider]);

  const currentLabel = models.find((m) => m.id === selectedModel)?.displayName || selectedModel;

  return (
    <div ref={dropRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input-field w-full flex items-center justify-between text-sm font-medium text-left"
        style={{ color: "var(--app-text)", minWidth: "200px" }}
      >
        <span className="flex items-center gap-2">
          {loading ? <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--app-muted-color)" }} /> : <Cpu size={12} className="shrink-0" style={{ color: "var(--app-primary)" }} />}
          {currentLabel || "Select model…"}
        </span>
        <ChevronDown size={14} style={{ color: "var(--app-muted-color)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && models.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-2xl overflow-hidden z-50 shadow-2xl"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", maxHeight: "14rem", overflowY: "auto" }}>
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => { onSelect(m.id); setOpen(false); }}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left text-sm transition-all"
              style={{
                background: m.id === selectedModel ? "color-mix(in srgb, var(--app-primary) 8%, transparent)" : "transparent",
                color: m.id === selectedModel ? "var(--app-primary)" : "var(--app-text)",
              }}
            >
              <span className="font-medium">{m.displayName}</span>
              {m.id === selectedModel && <CheckCircle size={12} style={{ color: "var(--app-primary)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AIProviderSection() {
  const { user } = useAuth();
  const [provider, setProvider]       = useState<"gemini" | "openai">("gemini");
  const [apiKey, setApiKey]           = useState("");
  const [model, setModel]             = useState("gemini-2.5-flash");
  const [showKey, setShowKey]         = useState(false);
  const [status, setStatus]           = useState<AiStatus>("idle");
  const [statusMsg, setStatusMsg]     = useState("");
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState("");
  const [loading, setLoading]         = useState(true);

  // Health dashboard
  const [lastSuccessAt, setLastSuccessAt]   = useState<Date | null>(null);
  const [lastError, setLastError]           = useState<string | null>(null);
  const [lastLatency, setLastLatency]       = useState<number | null>(null);
  const [lastModel, setLastModel]           = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "user_connections", user.uid)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as Record<string, string>;
        if (data.ai_provider) setProvider(data.ai_provider as "gemini" | "openai");
        if (data.ai_api_key) { setApiKey(data.ai_api_key); setStatus("connected"); }
        if (data.ai_model) setModel(data.ai_model);
      }
      setLoading(false);
    });
  }, [user]);

  async function handleTest() {
    if (!apiKey.trim()) return;
    setStatus("testing"); setStatusMsg(""); setLastError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch("/api/ai/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), model }),
      });
      const data = (await resp.json()) as { status: string; message: string; latencyMs?: number; model?: string };
      setStatus(data.status as AiStatus);
      setStatusMsg(data.message);
      if (data.latencyMs) setLastLatency(data.latencyMs);
      if (data.model) setLastModel(data.model);
      if (data.status === "connected") {
        setLastSuccessAt(new Date());
        setLastError(null);
      } else {
        setLastError(data.message);
      }
    } catch {
      setStatus("error"); setStatusMsg("Network error — check your connection.");
      setLastError("Network error");
    }
  }

  async function handleSave() {
    if (!user || !apiKey.trim()) return;
    setSaving(true); setSaveMsg("");
    try {
      await setDoc(doc(db, "user_connections", user.uid), {
        ai_provider: provider,
        ai_api_key: apiKey.trim(),
        ai_model: model,
        ai_updated_at: serverTimestamp(),
      }, { merge: true });
      setSaveMsg("AI provider saved successfully.");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch {
      setSaveMsg("Failed to save — try again.");
    } finally { setSaving(false); }
  }

  const meta = AI_STATUS_META[status];

  if (loading) return null;

  return (
    <section className="glass-card p-8 space-y-6" style={{ overflow: "visible" }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)" }}>
          <Brain size={20} style={{ color: "var(--app-primary)" }} />
        </div>
        <div>
          <h3 className="font-black text-lg tracking-tight" style={{ color: "var(--app-text)" }}>AI Provider</h3>
          <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
            Connect Gemini or ChatGPT to power the AI Agent
          </p>
        </div>
        {/* Status pill */}
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: `color-mix(in srgb, ${meta.dot} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${meta.dot} 25%, transparent)` }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: meta.dot, animation: status === "testing" ? "pulse 1s infinite" : "none" }} />
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
      </div>
      {/* Provider selector */}
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest mb-3 block" style={{ color: "var(--app-muted-color)" }}>Provider</label>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          {([
            { id: "gemini", label: "Gemini", sub: "Google AI" },
            { id: "openai", label: "ChatGPT", sub: "OpenAI" },
          ] as const).map((p) => (
            <button key={p.id} onClick={() => {
              setProvider(p.id);
              setStatus("idle"); setStatusMsg("");
              setModel(p.id === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");
            }}
              className="flex flex-col items-start gap-1 p-4 rounded-2xl text-left transition-all"
              style={{
                background: provider === p.id ? "color-mix(in srgb, var(--app-primary) 8%, transparent)" : "var(--app-bg)",
                border: `1.5px solid ${provider === p.id ? "var(--app-primary)" : "var(--app-border)"}`,
              }}>
              <span className="font-black text-sm" style={{ color: provider === p.id ? "var(--app-primary)" : "var(--app-text)" }}>{p.label}</span>
              <span className="text-[9px] font-medium" style={{ color: "var(--app-muted-color)" }}>{p.sub}</span>
            </button>
          ))}
        </div>
      </div>
      {/* API Key input */}
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
          <Key size={11} className="inline mr-1" />
          {provider === "gemini" ? "Gemini API Key" : "OpenAI API Key"}
        </label>
        <div className="relative max-w-lg">
          <input
            type={showKey ? "text" : "password"}
            placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setStatus("idle"); setStatusMsg(""); }}
            className="input-field w-full pr-12 font-mono text-sm"
          />
          <button onClick={() => setShowKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
            style={{ color: "var(--app-muted-color)" }}>
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {provider === "gemini" && (
          <p className="mt-1.5 text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
            Get your key at <span className="underline">aistudio.google.com/apikey</span>
          </p>
        )}
        {provider === "openai" && (
          <p className="mt-1.5 text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
            Get your key at <span className="underline">platform.openai.com/api-keys</span>
          </p>
        )}
      </div>
      {/* Model selector */}
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>
          <Cpu size={11} className="inline mr-1" />
          Model
        </label>
        <div className="max-w-lg">
          <ModelSelector
            provider={provider}
            apiKey={apiKey}
            selectedModel={model}
            onSelect={(id) => { setModel(id); setStatus("idle"); setStatusMsg(""); }}
          />
        </div>
        <p className="mt-1.5 text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
          {provider === "gemini" ? "Gemini 2.5 Flash recommended — fast, capable, free tier available." : "GPT-4o Mini recommended — great balance of speed and quality."}
        </p>
      </div>
      {/* Status message */}
      {statusMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            background: `color-mix(in srgb, ${meta.dot} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${meta.dot} 20%, transparent)`,
            color: meta.color,
          }}>
          {status === "connected" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {statusMsg}
          {lastLatency && status === "connected" && (
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest" style={{ color: meta.color }}>
              {lastLatency}ms
            </span>
          )}
        </div>
      )}
      {saveMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ background: "color-mix(in srgb,var(--app-success) 8%,transparent)", color: "var(--app-success)" }}>
          <CheckCircle size={16} /> {saveMsg}
        </div>
      )}
      {/* Action buttons */}
      <div className="flex flex-wrap mb-[26px] pl-[0px] pr-[0px] gap-[14px]">
        <button onClick={handleTest} disabled={!apiKey.trim() || status === "testing"}
          className="btn-outline flex items-center gap-2 bg-[#11b9818f] pl-[11px] pr-[11px] pt-[2px] pb-[2px] rounded-tl-[7px] rounded-tr-[7px] rounded-br-[7px] rounded-bl-[7px]"
          style={{ opacity: (!apiKey.trim() || status === "testing") ? 0.5 : 1 }}>
          {status === "testing" ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          Test Connection
        </button>
        <button onClick={handleSave} disabled={saving || !apiKey.trim()}
          className="btn-primary flex items-center gap-[10px] pl-[18px] pr-[18px] pt-[3px] pb-[3px] rounded-tl-[9px] rounded-tr-[9px] rounded-br-[9px] rounded-bl-[9px] ml-[-2px] mr-[-2px]"
          style={{ opacity: (saving || !apiKey.trim()) ? 0.5 : 1 }}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          Save Provider
        </button>
        {apiKey && (
          <button onClick={() => { setApiKey(""); setStatus("idle"); setStatusMsg(""); }}
            className="btn-outline flex items-center text-[#cf0808] ml-[-1px] mr-[-1px] pl-[25px] pr-[25px] rounded-tl-[6px] rounded-tr-[6px] rounded-br-[6px] rounded-bl-[6px] gap-[7px]"
            style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb,var(--app-danger) 30%,transparent)" }}>
            <XCircle size={16} /> Remove Key
          </button>
        )}
      </div>
      {/* API Health Dashboard */}
      {(lastSuccessAt || lastError || lastLatency) && (
        <div className="pt-5" style={{ borderTop: "1px solid var(--app-border)" }}>
          <h4 className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--app-muted-color)" }}>
            API Health Dashboard
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Provider</p>
              <p className="text-sm font-black capitalize" style={{ color: "var(--app-text)" }}>{provider}</p>
            </div>
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Model</p>
              <p className="text-xs font-black truncate" style={{ color: "var(--app-text)" }}>{lastModel || model}</p>
            </div>
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Response Time</p>
              <p className="text-sm font-black" style={{ color: lastLatency && lastLatency < 2000 ? "var(--app-success)" : lastLatency ? "#F97316" : "var(--app-muted-color)" }}>
                {lastLatency ? `${lastLatency}ms` : "—"}
              </p>
            </div>
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Last Success</p>
              <p className="text-xs font-black" style={{ color: lastSuccessAt ? "var(--app-success)" : "var(--app-muted-color)" }}>
                {lastSuccessAt ? lastSuccessAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
            </div>
          </div>
          {lastError && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: "color-mix(in srgb, var(--app-danger) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)", color: "var(--app-danger)" }}>
              <AlertCircle size={12} />
              <span className="font-bold">Last error:</span> {lastError}
            </div>
          )}
        </div>
      )}
      <p className="text-[9px] font-medium italic" style={{ color: "var(--app-muted-color)" }}>
        Your API key is stored securely in your personal account. It is never shared or logged.
      </p>
    </section>
  );
}

// ─── Telegram Section ─────────────────────────────────────────────────────────

interface TelegramStatus {
  botAvailable: boolean;
  connected: boolean;
  botUsername?: string;
  telegramUsername?: string;
  telegramFirstName?: string;
  connectedAt?: string;
}

function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [linkMsg, setLinkMsg] = useState("");

  const fetchStatus = async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const resp = await fetch("/api/telegram/status", {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      const data = await resp.json() as TelegramStatus;
      setStatus(data);
    } catch {
      setStatus({ botAvailable: false, connected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchStatus(); }, []);

  const handleGenerateLink = async () => {
    setLinking(true);
    setLinkMsg("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const resp = await fetch("/api/telegram/link/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      });
      const data = await resp.json() as { deepLink?: string; expiresInMinutes?: number; error?: string };
      if (!resp.ok || !data.deepLink) throw new Error(data.error || "Failed");
      setDeepLink(data.deepLink);
      setLinkMsg(`Link expires in ${data.expiresInMinutes ?? 10} minutes. Open Telegram to finish linking.`);
      setTimeout(() => void fetchStatus(), 4000);
    } catch (err: unknown) {
      setLinkMsg(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setLinking(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Telegram account from Select2Notion?")) return;
    setDisconnecting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch("/api/telegram/disconnect", {
        method: "DELETE",
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      setDeepLink(null);
      setLinkMsg("");
      await fetchStatus();
    } catch {
      setLinkMsg("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <section className="glass-card p-8">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--app-primary)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--app-muted-color)" }}>Loading Telegram status…</span>
        </div>
      </section>
    );
  }

  if (!status?.botAvailable) return null;

  const connectedAt = status.connectedAt
    ? new Date(status.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <section className="glass-card p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, #2AABEE 12%, transparent)", color: "#2AABEE" }}>
            <Send size={18} />
          </div>
          <div>
            <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Telegram Bot</h3>
            <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>
              Chat with your AI agent on Telegram
            </p>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0"
          style={{
            background: status.connected
              ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
              : "color-mix(in srgb, var(--app-muted-color) 10%, transparent)",
            border: `1px solid ${status.connected
              ? "color-mix(in srgb, var(--app-success) 25%, transparent)"
              : "color-mix(in srgb, var(--app-muted-color) 20%, transparent)"}`,
          }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: status.connected ? "var(--app-success)" : "#94A3B8" }} />
          <span className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: status.connected ? "var(--app-success)" : "var(--app-muted-color)" }}>
            {status.connected ? "Connected" : "Not Connected"}
          </span>
        </div>
      </div>
      {/* Connected state */}
      {status.connected ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Account</p>
              <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>
                {status.telegramUsername ? `@${status.telegramUsername}` : status.telegramFirstName ?? "—"}
              </p>
            </div>
            <div className="p-3 rounded-xl space-y-1" style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Connected</p>
              <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>{connectedAt ?? "—"}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-[17px] mt-[16px] mb-[16px]">
            <a
              href={`https://t.me/${status.botUsername ?? "select2notionmm_bot"}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary flex items-center gap-2 no-underline ml-[9px] mr-[9px] mt-[-7px] mb-[-7px] border-t-[4px] border-r-[4px] border-b-[4px] border-l-[4px] pl-[14px] pr-[14px] rounded-tl-[7px] rounded-tr-[7px] rounded-br-[7px] rounded-bl-[7px]"
              style={{ textDecoration: "none" }}>
              <ExternalLink size={16} />
              Open Bot
            </a>
            <button onClick={handleDisconnect} disabled={disconnecting}
              className="btn-outline flex items-center gap-2 rounded-tl-[7px] rounded-tr-[7px] rounded-br-[7px] rounded-bl-[7px] mt-[-2px] mb-[-2px] ml-[11px] mr-[11px] pl-[14px] pr-[14px] pt-[6px] pb-[6px]"
              style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", opacity: disconnecting ? 0.5 : 1 }}>
              {disconnecting ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        /* Not connected state */
        (<div className="space-y-4">
          <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
            Connect your Telegram account to chat with your AI trading agent, log trades, and get analysis — all from Telegram.
          </p>
          <div className="p-4 rounded-2xl space-y-2"
            style={{ background: "color-mix(in srgb, var(--app-primary) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 12%, transparent)" }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>How it works</p>
            <div className="space-y-1.5">
              {["Click \"Connect via Telegram\" below", "Telegram opens — tap Start", "Your account links automatically"].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-black"
                    style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
                    {i + 1}
                  </div>
                  <span className="text-xs font-medium" style={{ color: "var(--app-text)" }}>{step}</span>
                </div>
              ))}
            </div>
          </div>
          {deepLink ? (
            <div className="space-y-3">
              <a href={deepLink} target="_blank" rel="noopener noreferrer"
                className="btn-primary flex items-center justify-center gap-2 no-underline w-full"
                style={{ textDecoration: "none" }}>
                <ExternalLink size={16} />
                Open Telegram to Link
              </a>
              <button onClick={handleGenerateLink} disabled={linking}
                className="w-full text-center text-xs font-bold py-2"
                style={{ color: "var(--app-muted-color)" }}>
                Generate new link
              </button>
            </div>
          ) : (
            <button onClick={handleGenerateLink} disabled={linking}
              className="btn-primary flex items-center gap-2"
              style={{ opacity: linking ? 0.6 : 1 }}>
              {linking ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
              {linking ? "Generating…" : "Connect via Telegram"}
            </button>
          )}
          {linkMsg && (
            <p className="text-xs font-medium" style={{ color: deepLink ? "var(--app-success)" : "var(--app-muted-color)" }}>
              {linkMsg}
            </p>
          )}
        </div>)
      )}
      {/* ── News Alert Settings ───────────────────────────────────────── */}
      <NewsAlertSettings />

      <p className="text-[9px] font-medium italic" style={{ color: "var(--app-muted-color)" }}>
        Your Telegram ID is stored securely and only used to route messages to your account.
      </p>
    </section>
  );
}

interface TelegramNewsSettings {
  telegram: { news_alert_timing: number[] };
  news_filters: { impact: string[] };
}

function NewsAlertSettings() {
  const [settings, setSettings] = useState<TelegramNewsSettings>({
    telegram: { news_alert_timing: [60, 30, 15, 5, 1] },
    news_filters: { impact: ["HIGH", "MEDIUM", "LOW"] },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const resp = await fetch("/api/news/user-settings", {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        if (resp.ok) {
          const d = await resp.json() as { ok: boolean; settings?: TelegramNewsSettings };
          if (d.settings) setSettings(d.settings);
        }
      } catch { /* ignore */ }
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch("/api/news/user-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const timingOptions = [
    { mins: 60, label: "60 minutes before" },
    { mins: 30, label: "30 minutes before" },
    { mins: 15, label: "15 minutes before" },
    { mins: 5, label: "5 minutes before" },
    { mins: 1, label: "1 minute before" },
  ];

  const impactOptions = [
    { key: "HIGH", label: "High Impact", dotColor: "bg-red-400" },
    { key: "MEDIUM", label: "Medium Impact", dotColor: "bg-orange-400" },
    { key: "LOW", label: "Low Impact", dotColor: "bg-slate-400" },
  ];

  const toggleTiming = (m: number) => {
    const cur = settings.telegram.news_alert_timing;
    setSettings((s) => ({
      ...s,
      telegram: {
        news_alert_timing: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a),
      },
    }));
  };

  const toggleImpact = (k: string) => {
    const cur = settings.news_filters.impact;
    setSettings((s) => ({
      ...s,
      news_filters: { impact: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] },
    }));
  };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--app-border)", background: "var(--app-bg)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="p-2 rounded-xl flex-shrink-0" style={{ background: "color-mix(in srgb, #2AABEE 10%, transparent)", color: "#2AABEE" }}>
          <Bell size={14} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black" style={{ color: "var(--app-text)" }}>News Alert Settings</p>
          <p className="text-[10px]" style={{ color: "var(--app-muted-color)" }}>
            {settings.telegram.news_alert_timing.length} warning timings · {settings.news_filters.impact.length} impact levels
          </p>
        </div>
        {open ? <ChevronUp size={14} style={{ color: "var(--app-muted-color)" }} /> : <ChevronDown size={14} style={{ color: "var(--app-muted-color)" }} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t" style={{ borderColor: "var(--app-border)" }}>
          {/* Warning Timing */}
          <div className="pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--app-muted-color)" }}>
              Warning Timing Selection
            </p>
            <div className="space-y-2">
              {timingOptions.map(({ mins, label }) => {
                const active = settings.telegram.news_alert_timing.includes(mins);
                return (
                  <label key={mins} className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => toggleTiming(mins)}
                      className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
                      style={{
                        borderColor: active ? "#2AABEE" : "var(--app-border)",
                        background: active ? "#2AABEE" : "transparent",
                      }}
                    >
                      {active && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="text-sm font-medium" style={{ color: active ? "var(--app-text)" : "var(--app-muted-color)" }}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Impact Filter */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--app-muted-color)" }}>
              Economic Calendar Filter
            </p>
            <div className="space-y-2">
              {impactOptions.map(({ key, label, dotColor }) => {
                const active = settings.news_filters.impact.includes(key);
                return (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <div
                      onClick={() => toggleImpact(key)}
                      className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
                      style={{
                        borderColor: active ? "#2AABEE" : "var(--app-border)",
                        background: active ? "#2AABEE" : "transparent",
                      }}
                    >
                      {active && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                      <span className="text-sm font-medium" style={{ color: active ? "var(--app-text)" : "var(--app-muted-color)" }}>
                        {label}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-[9px] mt-2 font-medium" style={{ color: "var(--app-muted-color)" }}>
              Controls both dashboard display and Telegram notifications
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
            style={{ opacity: saving ? 0.7 : 1 }}
          >
            {saved ? (
              <><CheckCircle size={15} /> Saved!</>
            ) : saving ? (
              <><Loader2 size={15} className="animate-spin" /> Saving…</>
            ) : (
              <><Bell size={15} /> Save Alert Settings</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
