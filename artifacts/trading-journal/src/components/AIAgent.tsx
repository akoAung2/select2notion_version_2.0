import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Loader2, Settings2, AlertCircle, Trash2,
  TrendingUp, Brain, Target, BookOpen, Sparkles, Copy,
  CheckCircle, X, Database, Plus, Edit3, Undo2, Mic, MicOff, ChevronDown,
  Clock,
} from "lucide-react";
import { useAiChat, useAiConfirmAction, useAiVoice } from "@workspace/api-client-react";
import type { PendingAction } from "@workspace/api-client-react";
import { useAISession, type PersistedMessage } from "../hooks/useAISession";
import LogTradeWizard from "./LogTradeWizard";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
  intent?: string;
}

function toPersistedMessage(msg: Message): PersistedMessage {
  return { ...msg, timestamp: msg.timestamp.toISOString() };
}

function fromPersistedMessage(msg: PersistedMessage): Message {
  return { ...msg, timestamp: new Date(msg.timestamp) };
}

const STARTER_PROMPTS = [
  { icon: TrendingUp, label: "Performance", prompt: "Analyze my recent trading performance and identify my biggest strengths and weaknesses." },
  { icon: Brain, label: "Weekly Review", prompt: "Review last week's trades — show me win rate, PNL, best and worst setups." },
  { icon: Target, label: "Patterns", prompt: "Find hidden patterns in my trading — which sessions, setups and pairs perform best?" },
  { icon: BookOpen, label: "Risk", prompt: "Review my risk management. Am I sizing positions correctly and protecting my capital?" },
];

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <span className="whitespace-pre-wrap break-words">
      {lines.map((line, li) => {
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <span key={li}>
            {parts.map((part, i) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return <strong key={i} className="font-black">{part.slice(2, -2)}</strong>;
              }
              if (part.startsWith("`") && part.endsWith("`")) {
                return (
                  <code key={i} className="px-1.5 py-0.5 rounded-md text-[11px] font-mono"
                    style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                    {part.slice(1, -1)}
                  </code>
                );
              }
              return <span key={i}>{part}</span>;
            })}
            {li < lines.length - 1 && <br />}
          </span>
        );
      })}
    </span>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const intentBadge = !isUser && message.intent && message.intent !== "general_chat" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest mb-1"
      style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
      {message.intent === "trade_logger" && <><Database size={8} /> Trade Logger</>}
      {message.intent === "ask_database" && <><TrendingUp size={8} /> Database Query</>}
      {message.intent === "weekly_review" && <><BookOpen size={8} /> Weekly Review</>}
      {message.intent === "property_creator" && <><Plus size={8} /> Property Creator</>}
      {message.intent === "property_editor" && <><Edit3 size={8} /> Property Editor</>}
    </span>
  ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex gap-2 group ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: isUser ? "var(--app-primary)"
            : message.error ? "color-mix(in srgb, var(--app-danger) 15%, transparent)"
            : "color-mix(in srgb, var(--app-primary) 10%, transparent)",
          color: isUser ? "var(--app-primary-fg)"
            : message.error ? "var(--app-danger)"
            : "var(--app-primary)",
        }}>
        {isUser ? <User size={13} /> : message.error ? <AlertCircle size={13} /> : <Bot size={13} />}
      </div>

      <div className={`flex flex-col gap-1 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
        {intentBadge}
        <div className="px-3.5 py-2.5 text-sm leading-relaxed"
          style={{
            background: isUser ? "var(--app-primary)"
              : message.error ? "color-mix(in srgb, var(--app-danger) 8%, transparent)"
              : "var(--app-card)",
            color: isUser ? "var(--app-primary-fg)"
              : message.error ? "var(--app-danger)"
              : "var(--app-text)",
            border: isUser ? "none"
              : message.error ? "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)"
              : "1px solid var(--app-border)",
            borderRadius: isUser ? "1.25rem 0.375rem 1.25rem 1.25rem" : "0.375rem 1.25rem 1.25rem 1.25rem",
          }}>
          <MarkdownContent content={message.content} />
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] font-medium" style={{ color: "var(--app-muted-color)" }}>
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && !message.error && (
            <button onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-bold"
              style={{ color: copied ? "var(--app-success)" : "var(--app-muted-color)" }}>
              {copied ? <CheckCircle size={10} /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Confirmation Modal ────────────────────────────────────── */

function ConfirmationModal({
  action, onConfirm, onCancel, loading,
}: {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isTradeLogger = action.type === "save_trade";
  const isPropertyCreate = action.type === "create_property";
  const isPropertyRename = action.type === "rename_property";
  const title = isTradeLogger ? "Ready to Save Trade" : isPropertyCreate ? "Create Property" : "Rename Property";
  const icon = isTradeLogger ? <Database size={20} /> : isPropertyCreate ? <Plus size={20} /> : <Edit3 size={20} />;
  const entries: Array<[string, string]> = [];
  if (isTradeLogger && action.summary) {
    for (const [k, v] of Object.entries(action.summary)) {
      if (v !== null && v !== undefined && v !== "") entries.push([k, String(v)]);
    }
  } else if (isPropertyCreate) {
    if (action.name) entries.push(["Name", action.name]);
    if (action.propertyType) entries.push(["Type", action.propertyType]);
  } else if (isPropertyRename) {
    if (action.oldName) entries.push(["Current Name", action.oldName]);
    if (action.newName) entries.push(["New Name", action.newName]);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--app-primary), var(--app-secondary))" }} />
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                {icon}
              </div>
              <div>
                <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>{title}</h3>
                <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
                  Review before confirming
                </p>
              </div>
            </div>
            <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2 mb-6 max-h-60 overflow-y-auto">
            {entries.map(([key, val]) => (
              <div key={key} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>{key}</span>
                <span className="text-sm font-black ml-3 text-right" style={{ color: "var(--app-text)" }}>{val}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel} disabled={loading}
              className="flex-1 py-3 rounded-2xl text-sm font-black"
              style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={loading}
              className="flex-1 py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2"
              style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)", opacity: loading ? 0.7 : 1 }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {isTradeLogger ? "Save Trade" : isPropertyCreate ? "Create" : "Rename"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Voice processing status bubble ───────────────────────── */

const VOICE_STAGES = [
  "🎤 Recording received",
  "✅ Audio validated",
  "⬆️ Uploading audio",
  "📡 Audio uploaded",
  "🔤 Transcribing audio",
  "🌐 Detecting language",
] as const;

function VoiceStatusBubble({ stage, detectedLanguage }: { stage: string; detectedLanguage?: string | null }) {
  const currentIdx = VOICE_STAGES.indexOf(stage as typeof VOICE_STAGES[number]);
  const langLabel = detectedLanguage === "myanmar" ? "🇲🇲 Myanmar"
    : detectedLanguage === "english" ? "🇬🇧 English"
    : detectedLanguage === "mixed" ? "🌐 Mixed"
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2 flex-row"
    >
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
        <Mic size={12} />
      </div>
      <div className="flex flex-col gap-1 px-3.5 py-2.5"
        style={{
          background: "var(--app-card)",
          border: "1px solid var(--app-border)",
          borderRadius: "0.375rem 1.25rem 1.25rem 1.25rem",
        }}>
        {VOICE_STAGES.map((s, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          return (
            <div key={s} className="flex items-center gap-2">
              {done
                ? <CheckCircle size={10} style={{ color: "var(--app-success)", flexShrink: 0 }} />
                : current
                ? <Loader2 size={10} className="animate-spin" style={{ color: "var(--app-primary)", flexShrink: 0 }} />
                : <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "var(--app-border)" }} />}
              <span
                className={`text-xs ${current ? "font-bold" : "font-medium"}`}
                style={{ color: (done || current) ? "var(--app-text)" : "var(--app-muted-color)", opacity: i > currentIdx ? 0.45 : 1 }}
              >{s}</span>
            </div>
          );
        })}
        {langLabel && currentIdx >= VOICE_STAGES.length - 1 && (
          <div className="mt-1 flex items-center gap-1 text-[10px] font-black"
            style={{ color: "var(--app-primary)" }}>
            {langLabel}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Retry utility ─────────────────────────────────────────── */

async function withRetry<T>(fn: () => Promise<T>, delays = [1000, 3000, 5000]): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw lastErr;
}

/* ─── Main Component ────────────────────────────────────────── */

const COMMAND_OPTIONS = [
  { id: "chat", label: "💬 Chat", description: "Free chat mode" },
  { id: "logtrade", label: "📝 Log Trade", description: "Log a new trade", prompt: "I want to log a new trade" },
  { id: "coach", label: "🏋️ Coach", description: "Weekly coaching review", prompt: "Give me a comprehensive weekly trading coaching review — performance, psychology, risk management, and what to improve." },
  { id: "analyze", label: "📊 Analyze", description: "Performance analysis", prompt: "Analyze my recent trading performance — win rate, PNL, best/worst setups, sessions, and key patterns to work on." },
  { id: "review", label: "📅 Weekly Review", description: "Last 7 days review", prompt: "Show me a full review of my last 7 days: trades taken, win rate, total PNL, best and worst trade." },
];

export default function AIAgent({ onGoToSettings }: { onGoToSettings?: () => void }) {
  const {
    messages: sessionMsgs,
    setMessages: setSessionMessages,
    mode: sessionMode,
    setMode: setSessionMode,
    clearConversation,
    sessionExpired,
    dismissExpired,
    recordActivity,
  } = useAISession();

  const [messages, setMessages] = useState<Message[]>(() =>
    sessionMsgs.map(fromPersistedMessage),
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "uploading" | "transcribing" | "processing">("idle");
  const [voiceProcessingStage, setVoiceProcessingStage] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeCommand, setActiveCommand] = useState(sessionMode);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { mutateAsync: sendChat } = useAiChat();
  const { mutateAsync: confirmAction } = useAiConfirmAction();
  const { mutateAsync: transcribeVoice } = useAiVoice();

  const formatTimer = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setSessionMessages(messages.map(toPersistedMessage));
  }, [messages, setSessionMessages]);

  const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
    recordActivity();
  }, [recordActivity]);

  const handleSend = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isStreaming) return;
    addMessage({ role: "user", content });
    setInput("");
    setIsStreaming(true);
    recordActivity();
    if (inputRef.current) inputRef.current.style.height = "auto";
    const history = [...messages, { role: "user" as const, content }].map((m) => ({ role: m.role, content: m.content }));
    try {
      const data = await sendChat({ data: { messages: history } });
      const reply = data as { reply: string; intent?: string; pendingAction?: PendingAction };
      addMessage({ role: "assistant", content: reply.reply, intent: reply.intent });
      if (reply.pendingAction) setPendingAction(reply.pendingAction);
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data || {};
      const errorCode = errData?.error;
      let errorContent = errData?.message || "Something went wrong. Please try again.";
      if (errorCode === "no_ai_credentials") errorContent = "You haven't connected an AI provider yet. Go to Settings → AI Provider to add your API key.";
      else if (errorCode === "no_notion_credentials") errorContent = "This question needs your Notion data. Go to Connect Notion to set up your database first.";
      else if (errorCode === "invalid_key") errorContent = "Your AI API key is invalid. Update it in Settings → AI Provider.";
      else if (errorCode === "rate_limited") errorContent = "AI rate limit reached. Please wait a moment and try again.";
      addMessage({ role: "assistant", content: errorContent, error: true });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, addMessage, sendChat]);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    setConfirming(true);
    try {
      const result = await confirmAction({
        data: {
          actionType: pendingAction.type,
          data: pendingAction.type === "save_trade" ? { properties: pendingAction.properties }
            : pendingAction.type === "create_property" ? { name: pendingAction.name, propertyType: pendingAction.propertyType }
            : { oldName: pendingAction.oldName, newName: pendingAction.newName },
        },
      });
      const r = result as { success: boolean; message: string };
      addMessage({ role: "assistant", content: r.success ? r.message : `Error: ${r.message}`, error: !r.success });
    } catch {
      addMessage({ role: "assistant", content: "Action failed. Please try again.", error: true });
    } finally {
      setConfirming(false);
      setPendingAction(null);
    }
  }, [pendingAction, confirmAction, addMessage]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    addMessage({ role: "assistant", content: "Cancelled. No changes were made." });
  }, [addMessage]);

  const handleUndo = useCallback(async () => {
    setIsStreaming(true);
    try {
      const result = await confirmAction({ data: { actionType: "undo" } });
      const r = result as { success: boolean; message: string };
      addMessage({ role: "assistant", content: r.message, error: !r.success });
    } catch {
      addMessage({ role: "assistant", content: "Undo failed.", error: true });
    } finally {
      setIsStreaming(false);
    }
  }, [confirmAction, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const startRecording = useCallback(async () => {
    if (voiceStatus !== "idle" || isStreaming || voiceProcessingStage) return;
    setDetectedLanguage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 1000) {
          setVoiceStatus("idle");
          setRecordingSeconds(0);
          return;
        }

        setVoiceProcessingStage("🎤 Recording received");
        setVoiceStatus("uploading");

        try {
          // Use FileReader for efficient base64 encoding (replaces O(n²) string concatenation)
          const audioBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              // Strip "data:audio/...;base64," prefix to get raw base64
              resolve(result.split(",")[1] ?? result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          // Client-side size guard: base64 > 40 MB = beyond 5-minute limit
          if (audioBase64.length > 40 * 1024 * 1024) {
            addMessage({ role: "assistant", content: "Voice recording exceeds the 5-minute maximum. Please shorten your recording.", error: true });
            setVoiceProcessingStage(null);
            setVoiceStatus("idle");
            setRecordingSeconds(0);
            return;
          }

          setVoiceProcessingStage("⬆️ Uploading audio");
          setVoiceProcessingStage("🔤 Transcribing audio");
          setVoiceStatus("transcribing");

          const result = await withRetry(
            () => transcribeVoice({ data: { audioBase64, mimeType } }),
            [1000, 3000, 5000],
          );
          const { transcript, detectedLanguage: lang } = result as { transcript: string; detectedLanguage: string };

          if (lang && lang !== "unknown") setDetectedLanguage(lang);

          setVoiceProcessingStage("🌐 Detecting language");

          if (transcript?.trim()) {
            setVoiceStatus("processing");
            await handleSend(transcript.trim());
          }
        } catch (err: unknown) {
          const errData = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
          let userMsg = "Voice transcription failed. Please try again.";
          if (errData?.error === "GEMINI_RATE_LIMIT" || errData?.error === "OPENAI_RATE_LIMIT") userMsg = "AI rate limit reached. Please try again in 60 seconds.";
          else if (errData?.error === "VOICE_TOO_LARGE") userMsg = "Recording exceeds the 5-minute maximum. Please shorten your recording.";
          else if (errData?.error === "VOICE_FORMAT_ERROR") userMsg = "Unsupported audio format. Please try a different browser.";
          else if (errData?.error === "NETWORK_TIMEOUT") userMsg = "Server timeout processing audio. Try a shorter recording.";
          else if (errData?.error === "TRANSCRIPTION_FAILED") userMsg = "Audio could not be transcribed. Please speak clearly and try again.";
          addMessage({ role: "assistant", content: userMsg, error: true });
        } finally {
          setVoiceProcessingStage(null);
          setVoiceStatus("idle");
          setRecordingSeconds(0);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setVoiceStatus("recording");
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      addMessage({ role: "assistant", content: "Microphone access denied. Please allow microphone permission.", error: true });
      setVoiceStatus("idle");
    }
  }, [voiceStatus, isStreaming, voiceProcessingStage, transcribeVoice, handleSend, addMessage]);

  const stopRecording = useCallback(() => {
    if (voiceStatus !== "recording") return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
  }, [voiceStatus]);

  const toggleRecording = useCallback(() => {
    if (voiceStatus === "recording") stopRecording();
    else if (voiceStatus === "idle" && !isStreaming && !voiceProcessingStage) startRecording();
  }, [voiceStatus, isStreaming, voiceProcessingStage, startRecording, stopRecording]);

  // Auto-stop at 5-minute (300s) recording limit
  useEffect(() => {
    if (recordingSeconds >= 300 && voiceStatus === "recording") {
      stopRecording();
    }
  }, [recordingSeconds, voiceStatus, stopRecording]);

  useEffect(() => () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); }, []);

  const handleCommandSelect = useCallback((cmdId: string) => {
    setActiveCommand(cmdId);
    setSessionMode(cmdId);
    setShowCommandMenu(false);
    const cmd = COMMAND_OPTIONS.find((c) => c.id === cmdId);
    if (cmd && "prompt" in cmd && cmd.prompt) handleSend(cmd.prompt);
  }, [handleSend, setSessionMode]);

  const isVoiceActive = voiceStatus !== "idle" || voiceProcessingStage !== null;

  const isEmpty = messages.length === 0;
  const hasMessages = messages.length > 0;

  /* ── Shared streaming indicator ── */
  const StreamingDot = (size: "sm" | "md") => (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={`flex gap-${size === "sm" ? "2" : "3"}`}>
      <div className={`${size === "sm" ? "w-7 h-7 rounded-xl" : "w-8 h-8 rounded-2xl"} flex items-center justify-center flex-shrink-0 mt-0.5`}
        style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
        <Bot size={size === "sm" ? 13 : 14} />
      </div>
      <div className="px-3.5 py-2.5 flex items-center gap-2"
        style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: "0.375rem 1.25rem 1.25rem 1.25rem" }}>
        <Loader2 size={size === "sm" ? 13 : 14} className="animate-spin" style={{ color: "var(--app-primary)" }} />
        <span className="text-sm font-medium" style={{ color: "var(--app-muted-color)" }}>Thinking…</span>
      </div>
    </motion.div>
  );

  const mobilePanel = (
    <div className="flex flex-col md:hidden" style={{ position: "fixed", top: "53px", left: 0, right: 0, bottom: 0, zIndex: 40, background: "var(--app-bg)" }}>

        {/* Mobile compact header with action buttons */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 mt-[-3px] mb-[-3px] border-t-[0px] ml-[0px] mr-[0px]"
          style={{ height: "44px", borderBottom: "1px solid var(--app-border)", background: "var(--app-card)", flexShrink: 0 }}>
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
            {COMMAND_OPTIONS.find((c) => c.id === activeCommand)?.label ?? "💬 Chat"}
          </span>
          <div className="flex items-center gap-1">
            {hasMessages && (
              <>
                <button onClick={handleUndo} disabled={isStreaming} title="Undo"
                  className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-95"
                  style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <Undo2 size={14} />
                </button>
                <button onClick={() => { clearConversation(); setMessages([]); }} title="Clear"
                  className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-95"
                  style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
            {onGoToSettings && (
              <button onClick={onGoToSettings} title="AI Settings"
                className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-95"
                style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
                <Settings2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Mobile chat messages */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
          <AnimatePresence mode="sync">
            {isEmpty && !voiceProcessingStage ? (
              <motion.div key="empty-m" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center text-center px-4 h-full min-h-[280px] py-8 bg-[#00000003] pl-[0px] pr-[0px] pt-[25px] pb-[25px]">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                  <Bot size={22} />
                </div>
                <h3 className="text-base font-black mb-1" style={{ color: "var(--app-text)" }}>AI Trading Agent</h3>
                <p className="text-xs font-medium mb-5 max-w-[260px] leading-relaxed" style={{ color: "var(--app-muted-color)" }}>
                  Ask anything about your trades, performance, or journal
                </p>
                <div className="flex flex-wrap justify-center gap-2 max-w-[300px]">
                  {STARTER_PROMPTS.map((s) => {
                    const Icon = s.icon;
                    return (
                      <button key={s.label} onClick={() => handleSend(s.prompt)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold active:scale-95 transition-transform"
                        style={{
                          background: "color-mix(in srgb, var(--app-primary) 8%, transparent)",
                          border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                          color: "var(--app-primary)",
                        }}>
                        <Icon size={11} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="msgs-m" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="px-3 py-4 space-y-3">
                {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
                {voiceProcessingStage && <VoiceStatusBubble stage={voiceProcessingStage} detectedLanguage={detectedLanguage} />}
                {isStreaming && StreamingDot("sm")}
                <div ref={messagesEndRef} className="h-2" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile sticky input bar */}
        <div className="flex-shrink-0 flex flex-col ml-[0px] mr-[0px]"
          style={{ background: "var(--app-card)", borderTop: "1px solid var(--app-border)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>

          {/* Command selector row */}
          <div className="flex items-center px-3 pt-3 pb-1 gap-2">
            <div className="relative">
              <button
                onClick={() => setShowCommandMenu((p) => !p)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black transition-all"
                style={{
                  background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                  color: "var(--app-primary)",
                }}>
                {COMMAND_OPTIONS.find((c) => c.id === activeCommand)?.label ?? "💬 Chat"}
                <ChevronDown size={10} style={{ transform: showCommandMenu ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
              </button>
              {showCommandMenu && (
                <div className="absolute bottom-full left-0 mb-1.5 rounded-2xl overflow-hidden shadow-xl z-20"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", minWidth: "190px" }}>
                  {COMMAND_OPTIONS.map((cmd, i) => (
                    <button key={cmd.id} onClick={() => handleCommandSelect(cmd.id)}
                      className="w-full flex flex-col px-4 py-2.5 text-left"
                      style={{ borderBottom: i < COMMAND_OPTIONS.length - 1 ? "1px solid var(--app-border)" : "none" }}>
                      <span className="text-xs font-black" style={{ color: cmd.id === activeCommand ? "var(--app-primary)" : "var(--app-text)" }}>{cmd.label}</span>
                      <span className="text-[10px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>{cmd.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isVoiceActive && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold"
                style={{
                  background: voiceStatus === "recording" ? "color-mix(in srgb, #ef4444 12%, transparent)" : "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                  color: voiceStatus === "recording" ? "#ef4444" : "var(--app-primary)",
                }}>
                {voiceStatus === "recording" && <><span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />{formatTimer(recordingSeconds)}</>}
                {voiceStatus === "uploading" && <><Loader2 size={9} className="animate-spin" />Voice received…</>}
                {voiceStatus === "transcribing" && <><Loader2 size={9} className="animate-spin" />Transcribing…</>}
                {voiceStatus === "processing" && <><Loader2 size={9} className="animate-spin" />Processing…</>}
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="flex items-end gap-2 px-3 pb-1">
            <div className="flex-1 flex items-end rounded-[22px] px-4 py-2.5"
              style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", minHeight: "44px" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={voiceStatus === "recording" ? "🔴 Recording — tap mic to stop…" : voiceProcessingStage ? "Processing voice…" : "Ask anything…"}
                rows={1}
                disabled={isStreaming || isVoiceActive}
                className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed w-full"
                style={{ color: "var(--app-text)", maxHeight: "100px", minHeight: "22px" }}
                onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 100)}px`; }}
              />
            </div>
            <button
              onClick={toggleRecording}
              disabled={isStreaming || (isVoiceActive && voiceStatus !== "recording" && voiceStatus !== "idle")}
              title={voiceStatus === "recording" ? "Tap to stop" : "Tap to record"}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 select-none"
              style={{
                background: voiceStatus === "recording" ? "color-mix(in srgb, #ef4444 15%, transparent)" : "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                color: voiceStatus === "recording" ? "#ef4444" : "var(--app-primary)",
                transform: voiceStatus === "recording" ? "scale(1.12)" : "scale(1)",
                transition: "transform 0.12s, background 0.12s",
              }}>
              {voiceProcessingStage ? <Loader2 size={15} className="animate-spin" /> : voiceStatus === "recording" ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button onClick={() => handleSend()} disabled={!input.trim() || isStreaming}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-95"
              style={{
                background: !input.trim() || isStreaming ? "color-mix(in srgb, var(--app-primary) 20%, transparent)" : "var(--app-primary)",
                color: !input.trim() || isStreaming ? "color-mix(in srgb, var(--app-primary) 50%, transparent)" : "var(--app-primary-fg)",
                cursor: !input.trim() || isStreaming ? "not-allowed" : "pointer",
              }}>
              {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
  );

  return (
    <>
      {createPortal(mobilePanel, document.body)}
      {/* ── DESKTOP LAYOUT (≥ md) — unchanged ── */}
      <div className="hidden md:flex flex-col h-[calc(100dvh-12rem)] min-h-[400px] overflow-hidden">
        <div className="flex items-center justify-between mb-6 flex-shrink-0">
          <div>
            <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>AI Trading Agent</h2>
            <p className="font-medium text-sm mt-1" style={{ color: "var(--app-muted-color)" }}>
              Log trades · Analyze data · Chat in any language
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasMessages && (
              <>
                <button onClick={handleUndo} disabled={isStreaming}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  <Undo2 size={12} /> Undo
                </button>
                <button onClick={() => { clearConversation(); setMessages([]); inputRef.current?.focus(); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                  <Trash2 size={12} /> Clear
                </button>
              </>
            )}
            {onGoToSettings && (
              <button onClick={onGoToSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", color: "var(--app-muted-color)" }}>
                <Settings2 size={12} /> AI Settings
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-3xl mb-4"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}>
          <AnimatePresence mode="wait">
            {isEmpty && !voiceProcessingStage ? (
              <motion.div key="empty-d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-6"
                  style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                  <Sparkles size={28} />
                </div>
                <h3 className="text-xl font-black mb-2" style={{ color: "var(--app-text)" }}>How can I help you today?</h3>
                <p className="text-sm font-medium mb-8 max-w-md" style={{ color: "var(--app-muted-color)" }}>
                  Log a trade, analyze your data, or ask anything. Works in English, Myanmar, and more.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                  {STARTER_PROMPTS.map((s) => {
                    const Icon = s.icon;
                    return (
                      <button key={s.label} onClick={() => handleSend(s.prompt)}
                        className="flex items-center gap-3 p-4 rounded-2xl text-left transition-all hover:scale-[1.02]"
                        style={{
                          background: "color-mix(in srgb, var(--app-primary) 4%, transparent)",
                          border: "1px solid color-mix(in srgb, var(--app-primary) 15%, transparent)",
                        }}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: "color-mix(in srgb, var(--app-primary) 10%, transparent)", color: "var(--app-primary)" }}>
                          <Icon size={16} />
                        </div>
                        <span className="text-sm font-bold" style={{ color: "var(--app-text)" }}>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="msgs-d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 space-y-6">
                {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
                {voiceProcessingStage && <VoiceStatusBubble stage={voiceProcessingStage} detectedLanguage={detectedLanguage} />}
                {isStreaming && StreamingDot("md")}
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Desktop input box */}
        <div className="flex-shrink-0 rounded-3xl"
          style={{ background: "var(--app-card)", border: "1px solid var(--app-border)" }}>

          {/* Command selector + voice status row */}
          <div className="flex gap-2 px-4 pt-3 pb-2 justify-start items-center text-center text-[10px]">
            <div className="relative">
              <button
                onClick={() => setShowCommandMenu((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black transition-all hover:opacity-80 flex-row"
                style={{
                  background: "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--app-primary) 20%, transparent)",
                  color: "var(--app-primary)",
                }}>
                {COMMAND_OPTIONS.find((c) => c.id === activeCommand)?.label ?? "💬 Chat"}
                <ChevronDown size={11} style={{ transform: showCommandMenu ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
              </button>
              {showCommandMenu && (
                <div className="absolute bottom-full left-0 mb-2 rounded-2xl overflow-hidden shadow-xl z-20"
                  style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", minWidth: "220px" }}>
                  {COMMAND_OPTIONS.map((cmd, i) => (
                    <button key={cmd.id} onClick={() => handleCommandSelect(cmd.id)}
                      className="w-full flex flex-col px-4 py-3 text-left transition-colors"
                      style={{
                        borderBottom: i < COMMAND_OPTIONS.length - 1 ? "1px solid var(--app-border)" : "none",
                        background: cmd.id === activeCommand ? "color-mix(in srgb, var(--app-primary) 5%, transparent)" : "transparent",
                      }}>
                      <span className="text-sm font-black" style={{ color: cmd.id === activeCommand ? "var(--app-primary)" : "var(--app-text)" }}>{cmd.label}</span>
                      <span className="text-[11px] font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>{cmd.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isVoiceActive && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{
                  background: voiceStatus === "recording" ? "color-mix(in srgb, #ef4444 12%, transparent)" : "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                  color: voiceStatus === "recording" ? "#ef4444" : "var(--app-primary)",
                }}>
                {voiceStatus === "recording" && <><span className="w-2 h-2 rounded-full bg-current animate-pulse" />🔴 Recording {formatTimer(recordingSeconds)}</>}
                {voiceStatus === "uploading" && <><Loader2 size={11} className="animate-spin" />Voice received…</>}
                {voiceStatus === "transcribing" && <><Loader2 size={11} className="animate-spin" />Transcribing…</>}
                {voiceStatus === "processing" && <><Loader2 size={11} className="animate-spin" />Processing…</>}
              </div>
            )}
          </div>

          {/* Text + send row */}
          <div className="flex items-end gap-3 px-4 pb-4">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={voiceStatus === "recording" ? "🔴 Recording — click mic to stop…" : voiceProcessingStage ? "Processing voice…" : "Ask anything, log a trade, or say 'undo'… (Enter to send)"}
              rows={1}
              disabled={isStreaming || isVoiceActive}
              className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
              style={{ color: "var(--app-text)", maxHeight: "120px", minHeight: "24px" }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }}
            />
            <button
              onClick={toggleRecording}
              disabled={isStreaming || (isVoiceActive && voiceStatus !== "recording" && voiceStatus !== "idle")}
              title={voiceStatus === "recording" ? "Click to stop" : "Click to record"}
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 select-none"
              style={{
                background: voiceStatus === "recording" ? "color-mix(in srgb, #ef4444 15%, transparent)" : "color-mix(in srgb, var(--app-primary) 10%, transparent)",
                color: voiceStatus === "recording" ? "#ef4444" : "var(--app-primary)",
                transform: voiceStatus === "recording" ? "scale(1.12)" : "scale(1)",
                transition: "transform 0.12s, background 0.12s",
              }}>
              {voiceProcessingStage ? <Loader2 size={15} className="animate-spin" /> : voiceStatus === "recording" ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button onClick={() => handleSend()} disabled={!input.trim() || isStreaming}
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all"
              style={{
                background: !input.trim() || isStreaming ? "color-mix(in srgb, var(--app-primary) 20%, transparent)" : "var(--app-primary)",
                color: !input.trim() || isStreaming ? "color-mix(in srgb, var(--app-primary) 50%, transparent)" : "var(--app-primary-fg)",
                cursor: !input.trim() || isStreaming ? "not-allowed" : "pointer",
              }}>
              {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
      {/* Session Expired Banner */}
      <AnimatePresence>
        {sessionExpired && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl"
            style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", maxWidth: "340px", width: "calc(100% - 2rem)" }}>
            <Clock size={16} style={{ color: "var(--app-muted-color)", flexShrink: 0 }} />
            <p className="text-sm font-medium flex-1" style={{ color: "var(--app-text)" }}>
              Session expired after 20 minutes of inactivity.
            </p>
            <button onClick={dismissExpired}
              className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}>
              New
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* LogTrade Wizard — replaces ConfirmationModal for save_trade */}
      {pendingAction && pendingAction.type === "save_trade" && (
        <LogTradeWizard
          action={pendingAction}
          onComplete={(success, message) => {
            addMessage({ role: "assistant", content: message, error: !success });
            setPendingAction(null);
          }}
          onCancel={() => {
            setPendingAction(null);
            addMessage({ role: "assistant", content: "Cancelled. No changes were made." });
          }}
        />
      )}
      {/* Confirmation Modal — for non-trade actions (create/rename property, etc.) */}
      <AnimatePresence>
        {pendingAction && pendingAction.type !== "save_trade" && (
          <ConfirmationModal action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} loading={confirming} />
        )}
      </AnimatePresence>
    </>
  );
}
