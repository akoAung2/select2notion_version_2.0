import { useState, useEffect, useRef } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { signOut, type User } from "firebase/auth";
import {
  Loader2, CheckCircle, XCircle, Database, Key, ArrowRight,
  LogOut, ExternalLink, Zap, ChevronRight, AlertCircle, RotateCcw,
} from "lucide-react";
import { auth, db } from "../lib/firebase";
import {
  useTestNotionConnection,
  useNotionOAuthStart,
  useGetNotionOAuthPending,
  useAutoDetectNotion,
  getNotionOAuthStartQueryKey,
  getGetNotionOAuthPendingQueryKey,
} from "@workspace/api-client-react";

interface Props {
  user: User;
  onConnected: () => Promise<void>;
}

const TEMPLATE_URL =
  "https://ember-scilla-898.notion.site/select2notion_template-35f645f1a1b780378540e70818465993?source=copy_link";

type WizardStep =
  | "duplicate"     // Step 1: Duplicate the template
  | "choose"        // Step 2: Auto vs Manual
  | "auto"          // Step 3a: OAuth flow
  | "auto-detect"   // Step 3a: Schema fingerprint results
  | "manual"        // Step 3b: Token + DB ID form
  | "done";

type AutoState =
  | "idle"
  | "starting-oauth"
  | "waiting-popup"
  | "fetching-pending"
  | "detecting"
  | "detected"
  | "error";

type ManualStep = "idle" | "testing" | "tested-ok" | "tested-error" | "saving";

interface DetectMatch {
  database_id: string;
  title: string;
  score: number;
  matched_fields: string[];
  missing_fields: string[];
}

export default function ConnectNotion({ user, onConnected }: Props) {
  const [wizardStep, setWizardStep] = useState<WizardStep>("duplicate");

  // ── OAuth availability (checked once on mount) ──
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  // ── Auto-connect state ──
  const [autoState, setAutoState] = useState<AutoState>("idle");
  const [autoError, setAutoError] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [detectResult, setDetectResult] = useState<{
    status: string; best?: DetectMatch; all: DetectMatch[]; message?: string;
  } | null>(null);
  const [selectedDb, setSelectedDb] = useState<DetectMatch | null>(null);
  const popupRef = useRef<Window | null>(null);

  // ── Manual-connect state ──
  const [apiKey, setApiKey] = useState("");
  const [dbId, setDbId] = useState("");
  const [manualStep, setManualStep] = useState<ManualStep>("idle");
  const [testMessage, setTestMessage] = useState("");

  // disabled so they don't auto-fetch — we call .refetch() manually
  const oauthStart = useNotionOAuthStart({ query: { queryKey: getNotionOAuthStartQueryKey(), enabled: false, staleTime: Infinity } });
  const oauthPending = useGetNotionOAuthPending({ query: { queryKey: getGetNotionOAuthPendingQueryKey(), enabled: false, staleTime: Infinity } });
  const autoDetect = useAutoDetectNotion();
  const testNotion = useTestNotionConnection();

  // ── Check OAuth availability when user reaches the "choose" step ──
  // (not on mount — auth token may not be ready that early)
  useEffect(() => {
    if (wizardStep !== "choose" || oauthAvailable !== null) return;
    oauthStart.refetch().then((result) => {
      const available = result.data?.oauthAvailable ?? false;
      setOauthAvailable(available);
      if (available && result.data?.url) setOauthUrl(result.data.url);
    }).catch(() => setOauthAvailable(false));
  }, [wizardStep]);

  // ── Listen for message from OAuth popup ──
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== "notion-oauth-done") return;
      if (!e.data.success) {
        setAutoError("OAuth was cancelled or failed. Please try again.");
        setAutoState("error");
        return;
      }
      setAutoState("fetching-pending");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Poll for popup closure (mobile fallback — window.close() is often blocked) ──
  useEffect(() => {
    if (autoState !== "waiting-popup") return;
    const interval = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(interval);
        setAutoState("fetching-pending");
      }
    }, 600);
    return () => clearInterval(interval);
  }, [autoState]);

  // ── Fetch pending token when popup closes ──
  useEffect(() => {
    if (autoState !== "fetching-pending") return;
    oauthPending.refetch().then((result) => {
      if (result.data?.access_token) {
        const token = result.data.access_token;
        setPendingToken(token);
        runAutoDetect(token);
      } else {
        setAutoError("Could not retrieve Notion token. Please try again.");
        setAutoState("error");
      }
    });
  }, [autoState]);

  const runAutoDetect = (token: string) => {
    setAutoState("detecting");
    autoDetect.mutate(
      { data: { notion_token: token } },
      {
        onSuccess: (data) => {
          setDetectResult(data as unknown as typeof detectResult);
          if (data.status === "matched" && data.best) {
            setSelectedDb(data.best as unknown as DetectMatch);
          } else if ((data.all ?? []).length > 0) {
            setSelectedDb((data.all ?? [])[0] as unknown as DetectMatch);
          }
          setAutoState("detected");
          setWizardStep("auto-detect");
        },
        onError: () => {
          setAutoError("Failed to scan your Notion workspace. Try manual connection.");
          setAutoState("error");
        },
      },
    );
  };

  const handleStartOAuth = () => {
    setAutoState("starting-oauth");
    setAutoError("");
    // Use the pre-fetched URL if available; otherwise re-fetch
    const doOpen = (url: string) => {
      const popup = window.open(url, "notion-oauth", "width=600,height=700,scrollbars=yes");
      if (!popup) {
        setAutoError("Popup was blocked. Please allow popups and try again.");
        setAutoState("error");
        return;
      }
      popupRef.current = popup;
      setAutoState("waiting-popup");
    };

    if (oauthUrl) {
      doOpen(oauthUrl);
      return;
    }
    oauthStart.refetch().then((result) => {
      if (!result.data?.oauthAvailable || !result.data?.url) {
        setAutoError("Notion OAuth is not configured. Use Manual Connect instead.");
        setAutoState("error");
        return;
      }
      setOauthUrl(result.data.url);
      doOpen(result.data.url);
    });
  };

  const handleConfirmDetected = async () => {
    if (!selectedDb || !pendingToken) return;
    setAutoState("idle");
    try {
      await setDoc(doc(db, "user_connections", user.uid), {
        notion_token: pendingToken,
        notion_database_id: selectedDb.database_id,
        connected_at: serverTimestamp(),
        workspace_auto_detected: true,
      });
      setWizardStep("done");
      await new Promise((r) => setTimeout(r, 700));
      await onConnected();
    } catch (err) {
      setAutoError("Failed to save connection. Check Firestore security rules.");
    }
  };

  const handleManualTest = () => {
    setManualStep("testing");
    setTestMessage("");
    testNotion.mutate(
      { data: { apiKey: apiKey.trim(), databaseId: dbId.trim() } },
      {
        onSuccess: (data) => {
          setManualStep(data.status === "OK" ? "tested-ok" : "tested-error");
          setTestMessage(data.message ?? "");
        },
        onError: () => {
          setManualStep("tested-error");
          setTestMessage("❌ Connection failed. Check your credentials.");
        },
      },
    );
  };

  const handleManualSave = async () => {
    if (!apiKey.trim() || !dbId.trim()) return;
    setManualStep("saving");
    try {
      await setDoc(doc(db, "user_connections", user.uid), {
        notion_token: apiKey.trim(),
        notion_database_id: dbId.trim(),
        connected_at: serverTimestamp(),
      });
      setWizardStep("done");
      await new Promise((r) => setTimeout(r, 700));
      await onConnected();
    } catch {
      setManualStep("tested-ok");
      setTestMessage("Save failed — check Firestore security rules.");
    }
  };

  // ── Progress indicator ──
  const steps = ["Duplicate", "Connect", "Verify"];
  const progressStep =
    wizardStep === "duplicate" ? 0 :
    wizardStep === "choose" ? 1 :
    wizardStep === "done" ? 3 : 2;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--app-bg)" }}>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <img
          src="/logo.jpg"
          alt="Select2Notion logo"
          className="w-12 h-12 rounded-2xl object-cover"
          style={{ boxShadow: "0 8px 20px -4px color-mix(in srgb, var(--app-primary) 35%, transparent)" }}
        />
        <div>
          <p className="font-black text-lg leading-none" style={{ color: "var(--app-text)" }}>TradeEdge</p>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Notion Journal</p>
        </div>
      </div>
      {/* Progress bar */}
      <div className="w-full max-w-lg mb-6">
        <div className="flex items-center gap-2">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all"
                  style={{
                    background: i < progressStep ? "var(--app-primary)" : i === progressStep ? "color-mix(in srgb, var(--app-primary) 15%, transparent)" : "var(--app-card)",
                    color: i <= progressStep ? "var(--app-primary)" : "var(--app-muted-color)",
                    border: `2px solid ${i <= progressStep ? "var(--app-primary)" : "var(--app-border)"}`,
                  }}
                >
                  {i < progressStep ? <CheckCircle size={14} /> : i + 1}
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: i <= progressStep ? "var(--app-primary)" : "var(--app-muted-color)" }}>{label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 mt-[-16px] rounded-full transition-all"
                  style={{ background: i < progressStep ? "var(--app-primary)" : "var(--app-border)" }} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="w-full max-w-lg space-y-4">

        {/* ── STEP 1: Duplicate template ── */}
        {wizardStep === "duplicate" && (
          <>
            <div className="glass-card p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                <Database size={28} />
              </div>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
                Set Up Your Trading Journal
              </h1>
              <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                TradeEdge uses your own private Notion database. Start by duplicating our official template into your Notion workspace.
              </p>
              <a href={TEMPLATE_URL} target="_blank" rel="noreferrer" className="btn-primary inline-flex pl-[37px] pr-[37px] pt-[10px] pb-[10px] rounded-tl-[17px] rounded-tr-[17px] rounded-br-[17px] rounded-bl-[17px]">
                <ExternalLink size={18} />
                Duplicate Notion Template
              </a>
            </div>

            <div className="glass-card p-6 space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>
                Quick guide
              </h3>
              <ol className="text-[11px] space-y-2 leading-relaxed font-medium" style={{ color: "var(--app-muted-color)" }}>
                <li>1. Click "Duplicate Notion Template" above</li>
                <li>2. In Notion, click <strong style={{ color: "var(--app-text)" }}>Duplicate</strong> in the top-right corner</li>
                <li>3. Choose your workspace and confirm</li>
                <li>4. Come back here and click the button below</li>
              </ol>
            </div>

            <button onClick={() => setWizardStep("choose")} className="btn-primary w-full mt-[3px] pl-[24px] pr-[24px] pt-[8px] pb-[8px] border-t-[0px] border-r-[0px] border-b-[0px] border-l-[0px] rounded-tl-[10px] rounded-tr-[10px] rounded-br-[10px] rounded-bl-[10px] mb-[34px] font-extrabold">
              I've Duplicated the Template
              <ChevronRight size={18} />
            </button>
          </>
        )}

        {/* ── STEP 2: Choose connection method ── */}
        {wizardStep === "choose" && (
          <>
            <div className="glass-card p-8 text-center space-y-3">
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
                How would you like to connect?
              </h1>
              <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
                Choose the method that works best for you.
              </p>
            </div>

            {/* Auto Connect — shown if OAuth is available or still loading */}
            {oauthAvailable !== false && (
              <button
                onClick={() => { setWizardStep("auto"); setAutoState("idle"); }}
                disabled={oauthAvailable === null}
                className="w-full glass-card p-6 text-left flex items-start gap-4 transition-all hover:scale-[1.01]"
                style={{
                  cursor: oauthAvailable === null ? "default" : "pointer",
                  border: "2px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                  opacity: oauthAvailable === null ? 0.6 : 1,
                }}
              >
                <div className="p-3 rounded-xl shrink-0"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                  {oauthAvailable === null ? <Loader2 size={22} className="animate-spin" /> : <Zap size={22} />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Auto Connect</h3>
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>Recommended</span>
                  </div>
                  <p className="text-xs font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                    Sign in with Notion OAuth. We automatically scan your workspace and detect the correct database using schema fingerprinting. No API keys needed.
                  </p>
                </div>
                {oauthAvailable !== null && <ChevronRight size={18} style={{ color: "var(--app-muted-color)" }} className="shrink-0 mt-1" />}
              </button>
            )}

            {/* Manual Connect */}
            <button
              onClick={() => { setWizardStep("manual"); setManualStep("idle"); }}
              className="w-full glass-card p-6 text-left flex items-start gap-4 transition-all hover:scale-[1.01]"
              style={{ cursor: "pointer", ...(oauthAvailable === false ? { border: "2px solid color-mix(in srgb, var(--app-primary) 20%, transparent)" } : {}) }}
            >
              <div className="p-3 rounded-xl shrink-0"
                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                <Key size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>Manual Connect</h3>
                  {oauthAvailable === false && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>Recommended</span>
                  )}
                </div>
                <p className="text-xs font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                  Enter your Notion Integration Token and Database ID manually. Useful if you've already set up a Notion integration.
                </p>
              </div>
              <ChevronRight size={18} style={{ color: "var(--app-muted-color)" }} className="shrink-0 mt-1" />
            </button>

            {oauthAvailable === false && (
              <p className="text-[11px] text-center font-medium" style={{ color: "var(--app-muted-color)" }}>
                Notion OAuth is not configured on this server — use Manual Connect below.
              </p>
            )}

            <button onClick={() => setWizardStep("duplicate")}
              className="text-xs font-medium flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--app-muted-color)" }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 3a: Auto Connect (OAuth) ── */}
        {wizardStep === "auto" && (
          <>
            <div className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                  <Zap size={20} />
                </div>
                <div>
                  <h2 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Auto Connect via Notion</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>OAuth — no API key required</p>
                </div>
              </div>

              <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                A popup will open for you to authorize TradeEdge to access your Notion workspace. After authorization, we'll automatically find your trading database.
              </p>

              {/* Status states */}
              {autoState === "waiting-popup" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: "color-mix(in srgb, var(--app-primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)" }}>
                    <Loader2 size={16} className="animate-spin shrink-0" style={{ color: "var(--app-primary)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--app-primary)" }}>
                      Waiting for Notion authorization… complete the popup to continue.
                    </span>
                  </div>
                  <button
                    onClick={() => setAutoState("fetching-pending")}
                    className="w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all"
                    style={{ background: "color-mix(in srgb, var(--app-primary) 12%, transparent)", color: "var(--app-primary)", border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)" }}
                  >
                    ✓ I've authorized Notion — Continue
                  </button>
                  <p className="text-[11px] text-center font-medium" style={{ color: "var(--app-muted-color)" }}>
                    On mobile? Tap above after approving in Notion.
                  </p>
                </div>
              )}

              {autoState === "fetching-pending" && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)" }}>
                  <Loader2 size={16} className="animate-spin shrink-0" style={{ color: "var(--app-primary)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--app-primary)" }}>Retrieving token…</span>
                </div>
              )}

              {autoState === "detecting" && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)" }}>
                  <Loader2 size={16} className="animate-spin shrink-0" style={{ color: "var(--app-primary)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--app-primary)" }}>
                    Scanning your workspace for the TradeEdge database…
                  </span>
                </div>
              )}

              {autoState === "error" && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--app-danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--app-danger) 15%, transparent)" }}>
                  <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--app-danger)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--app-danger)" }}>{autoError}</span>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleStartOAuth}
                  disabled={autoState === "starting-oauth" || autoState === "waiting-popup" || autoState === "fetching-pending" || autoState === "detecting"}
                  className="btn-primary text-center mt-[5px] mb-[5px] pl-[16px] pr-[16px] text-[16px] font-extrabold pt-[4px] pb-[4px] rounded-tl-[12px] rounded-tr-[12px] rounded-br-[12px] rounded-bl-[12px]"
                >
                  {autoState === "starting-oauth" ? (
                    <><Loader2 size={18} className="animate-spin" />Opening Notion…</>
                  ) : autoState === "waiting-popup" || autoState === "fetching-pending" || autoState === "detecting" ? (
                    <><Loader2 size={18} className="animate-spin" />Processing…</>
                  ) : autoState === "error" ? (
                    <><RotateCcw size={18} />Try Again</>
                  ) : (
                    <><Zap size={18} />Connect with Notion OAuth</>
                  )}
                </button>

                <button onClick={() => setWizardStep("manual")} className="btn-outline text-sm ml-[1px] mr-[1px] pl-[20px] pr-[20px] pt-[5px] pb-[5px] rounded-tl-[13px] rounded-tr-[13px] rounded-br-[13px] rounded-bl-[13px] border-t-[0px] border-r-[0px] border-b-[0px] border-l-[0px] bg-[#c4c2c2f2]">
                  <Key size={16} />
                  Switch to Manual Connect
                </button>
              </div>
            </div>

            <button onClick={() => setWizardStep("choose")}
              className="text-xs font-medium flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--app-muted-color)" }}>← Back</button>
          </>
        )}

        {/* ── STEP 3a: Auto-detect results ── */}
        {wizardStep === "auto-detect" && detectResult && (
          <>
            <div className="glass-card p-8 space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--app-success) 10%, transparent)", color: "var(--app-success)" }}>
                  <Database size={20} />
                </div>
                <div>
                  <h2 className="font-black text-lg" style={{ color: "var(--app-text)" }}>
                    {detectResult.status === "matched" ? "Database Detected!" :
                     detectResult.status === "multiple" ? "Multiple Matches Found" : "No Exact Match"}
                  </h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Schema fingerprint results</p>
                </div>
              </div>

              {detectResult.message && (
                <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>{detectResult.message}</p>
              )}

              {/* Database list */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {detectResult.all.slice(0, 5).map((match) => (
                  <button
                    key={match.database_id}
                    onClick={() => setSelectedDb(match)}
                    className="w-full p-4 rounded-xl text-left transition-all"
                    style={{
                      background: selectedDb?.database_id === match.database_id
                        ? "color-mix(in srgb, var(--app-primary) 8%, transparent)"
                        : "var(--app-card)",
                      border: `2px solid ${selectedDb?.database_id === match.database_id ? "var(--app-primary)" : "var(--app-border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-sm" style={{ color: "var(--app-text)" }}>{match.title}</span>
                      <span
                        className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{
                          background: match.score >= 75 ? "color-mix(in srgb, var(--app-success) 15%, transparent)" : "color-mix(in srgb, var(--app-warning, #F59E0B) 15%, transparent)",
                          color: match.score >= 75 ? "var(--app-success)" : "#D97706",
                        }}
                      >
                        {match.score}% match
                      </span>
                    </div>
                    {match.missing_fields.length > 0 && (
                      <p className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
                        Missing: {match.missing_fields.join(", ")}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleConfirmDetected}
                  disabled={!selectedDb}
                  className="btn-primary"
                >
                  <CheckCircle size={18} />
                  Use "{selectedDb?.title || "Selected Database"}"
                </button>
                <button onClick={() => { setWizardStep("manual"); setManualStep("idle"); }} className="btn-outline">
                  <Key size={16} />
                  Connect Manually Instead
                </button>
              </div>
            </div>

            <button onClick={() => { setWizardStep("auto"); setAutoState("idle"); }}
              className="text-xs font-medium flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--app-muted-color)" }}>← Retry OAuth</button>
          </>
        )}

        {/* ── STEP 3b: Manual connect ── */}
        {wizardStep === "manual" && (
          <>
            <div className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                  <Key size={20} />
                </div>
                <div>
                  <h2 className="font-black text-lg" style={{ color: "var(--app-text)" }}>Manual Connection</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>Integration token + database ID</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Integration Token</label>
                  <input type="password" placeholder="ntn_..." value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setManualStep("idle"); setTestMessage(""); }}
                    className="input-field" disabled={manualStep === "saving"} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--app-muted-color)" }}>Database ID</label>
                  <input type="text" placeholder="d06645f1a1b782..." value={dbId}
                    onChange={(e) => { setDbId(e.target.value); setManualStep("idle"); setTestMessage(""); }}
                    className="input-field" disabled={manualStep === "saving"} />
                </div>

                {testMessage && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{
                      background: manualStep === "tested-ok"
                        ? "color-mix(in srgb, var(--app-success) 10%, transparent)"
                        : "color-mix(in srgb, var(--app-danger) 10%, transparent)",
                      border: `1px solid color-mix(in srgb, ${manualStep === "tested-ok" ? "var(--app-success)" : "var(--app-danger)"} 20%, transparent)`,
                    }}>
                    {manualStep === "tested-ok"
                      ? <CheckCircle size={16} className="shrink-0" style={{ color: "var(--app-success)" }} />
                      : <XCircle size={16} className="shrink-0" style={{ color: "var(--app-danger)" }} />}
                    <span className="text-sm font-medium"
                      style={{ color: manualStep === "tested-ok" ? "var(--app-success)" : "var(--app-danger)" }}>
                      {testMessage}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={handleManualTest}
                  disabled={manualStep === "testing" || manualStep === "saving" || !apiKey.trim() || !dbId.trim()}
                  className="btn-outline flex-1">
                  {manualStep === "testing" ? <><Loader2 size={16} className="animate-spin" />Testing…</> : <><Database size={16} />Test</>}
                </button>
                <button onClick={handleManualSave}
                  disabled={manualStep !== "tested-ok" || !apiKey.trim() || !dbId.trim()}
                  className="btn-primary flex-1">
                  {manualStep === "saving" ? <><Loader2 size={18} className="animate-spin" />Saving…</> : <>Save &amp; Connect<ArrowRight size={18} /></>}
                </button>
              </div>

              <div className="p-5 rounded-2xl space-y-2"
                style={{ background: "color-mix(in srgb, var(--app-primary) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--app-primary) 10%, transparent)" }}>
                <h4 className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--app-primary)" }}>How to get your credentials</h4>
                <ol className="text-[11px] space-y-1.5 leading-relaxed font-medium list-none" style={{ color: "var(--app-muted-color)" }}>
                  <li>1. Go to <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--app-primary)" }}>notion.so/my-integrations</a> → New integration</li>
                  <li>2. Copy the <strong style={{ color: "var(--app-text)" }}>Integration Token</strong> (starts with ntn_...)</li>
                  <li>3. Open your duplicated database → ••• → Connections → add your integration</li>
                  <li>4. Copy the <strong style={{ color: "var(--app-text)" }}>Database ID</strong> from the URL</li>
                </ol>
              </div>
            </div>

            <button onClick={() => setWizardStep("choose")}
              className="text-xs font-medium flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--app-muted-color)" }}>← Back</button>
          </>
        )}

        {/* ── Done ── */}
        {wizardStep === "done" && (
          <div className="glass-card p-10 text-center space-y-4">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "color-mix(in srgb, var(--app-success) 15%, transparent)", color: "var(--app-success)" }}>
              <CheckCircle size={40} />
            </div>
            <h2 className="text-2xl font-black" style={{ color: "var(--app-text)" }}>All Connected!</h2>
            <p className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>
              Your Notion database is linked. Loading your dashboard…
            </p>
            <Loader2 size={20} className="animate-spin mx-auto" style={{ color: "var(--app-primary)" }} />
          </div>
        )}

        {/* Sign out */}
        {wizardStep !== "done" && (
          <div className="text-center pt-2">
            <button onClick={() => signOut(auth)}
              className="text-xs font-medium flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--app-muted-color)" }}>
              <LogOut size={12} />Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
