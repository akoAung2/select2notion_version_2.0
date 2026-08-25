import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "s2n_ai_session_v1";
const INACTIVITY_MS = 20 * 60 * 1000;

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  error?: boolean;
  intent?: string;
}

export interface AISessionState {
  sessionId: string;
  mode: string;
  messages: PersistedMessage[];
  draftTrade: Record<string, unknown> | null;
  currentStep: string | null;
  lastActivity: string;
}

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function freshSession(): AISessionState {
  return {
    sessionId: makeId(),
    mode: "chat",
    messages: [],
    draftTrade: null,
    currentStep: null,
    lastActivity: new Date().toISOString(),
  };
}

function loadSession(): AISessionState | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AISessionState;
    const age = Date.now() - new Date(s.lastActivity).getTime();
    if (age >= INACTIVITY_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function persist(s: AISessionState) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function clearPersisted() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function useAISession() {
  const [session, setSessionRaw] = useState<AISessionState>(() => loadSession() ?? freshSession());
  const [sessionExpired, setSessionExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSession = useCallback((updater: AISessionState | ((prev: AISessionState) => AISessionState)) => {
    setSessionRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persist(next);
      return next;
    });
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSession(freshSession());
      clearPersisted();
      setSessionExpired(true);
    }, INACTIVITY_MS);
  }, [setSession]);

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [resetTimer]);

  const recordActivity = useCallback(() => {
    setSession((prev) => ({ ...prev, lastActivity: new Date().toISOString() }));
    setSessionExpired(false);
    resetTimer();
  }, [setSession, resetTimer]);

  const setMessages = useCallback((msgs: PersistedMessage[]) => {
    setSession((prev) => ({ ...prev, messages: msgs, lastActivity: new Date().toISOString() }));
    resetTimer();
  }, [setSession, resetTimer]);

  const setMode = useCallback((mode: string) => {
    setSession((prev) => ({ ...prev, mode, lastActivity: new Date().toISOString() }));
  }, [setSession]);

  const setDraftTrade = useCallback((draft: Record<string, unknown> | null) => {
    setSession((prev) => ({ ...prev, draftTrade: draft, lastActivity: new Date().toISOString() }));
  }, [setSession]);

  const setCurrentStep = useCallback((step: string | null) => {
    setSession((prev) => ({ ...prev, currentStep: step, lastActivity: new Date().toISOString() }));
  }, [setSession]);

  const clearConversation = useCallback(() => {
    const fresh = freshSession();
    setSessionRaw(fresh);
    persist(fresh);
    setSessionExpired(false);
    resetTimer();
  }, [resetTimer]);

  const dismissExpired = useCallback(() => {
    setSessionExpired(false);
    clearConversation();
  }, [clearConversation]);

  return {
    session,
    messages: session.messages,
    mode: session.mode,
    draftTrade: session.draftTrade,
    currentStep: session.currentStep,
    sessionExpired,
    setMessages,
    setMode,
    setDraftTrade,
    setCurrentStep,
    clearConversation,
    recordActivity,
    dismissExpired,
  };
}
