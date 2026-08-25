import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AudioLines, Loader2, Mic, MicOff, Pause, Play, Volume2 } from "lucide-react";
import { useAiChat, useAiVoice } from "@workspace/api-client-react";
import { auth } from "../lib/firebase";

type Language = "myanmar" | "english" | "mixed" | "unknown";
type State = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";
type Entry = { id: string; transcript: string; reply?: string; language: Language; audioUrl?: string; error?: string; at: Date };

const stateLabel: Record<State, string> = { idle: "Tap to talk", recording: "Listening… tap to stop", transcribing: "Transcribing…", thinking: "Thinking…", speaking: "Speaking", error: "Try again" };

export default function VoiceAssistant() {
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<State>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem("s2n_voice_speed")) || 1);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const { mutateAsync: transcribe } = useAiVoice();
  const { mutateAsync: chat } = useAiChat();

  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()); audio.current?.pause(); entries.forEach((entry) => entry.audioUrl && URL.revokeObjectURL(entry.audioUrl)); }, [entries]);
  useEffect(() => { localStorage.setItem("s2n_voice_speed", String(speed)); if (audio.current) audio.current.playbackRate = speed; }, [speed]);

  const synthesize = useCallback(async (text: string, language: Language) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Authentication required");
    const response = await fetch("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, language, speed }),
    });
    if (!response.ok) throw new Error("TTS unavailable");
    return URL.createObjectURL(await response.blob());
  }, [speed]);

  const processAudio = useCallback(async (blob: Blob, mimeType: string) => {
    setState("transcribing");
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = reject; reader.readAsDataURL(blob); });
      const stt = await transcribe({ data: { audioBase64: base64, mimeType } }) as { transcript: string; detectedLanguage: Language };
      if (!stt.transcript.trim()) throw new Error("No speech detected");
      setState("thinking");
      // /ai/chat is the single reasoning + Notion tool path; Redis merges its same-user session.
      const result = await chat({ data: { messages: [{ role: "user", content: stt.transcript }] } }) as { reply: string };
      const entry: Entry = { id: crypto.randomUUID(), transcript: stt.transcript, reply: result.reply, language: stt.detectedLanguage, at: new Date() };
      setEntries((current) => [...current, entry]);
      try {
        const audioUrl = await synthesize(result.reply, stt.detectedLanguage);
        setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, audioUrl } : item));
      } catch {
        setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, error: "Voice playback unavailable. You can still read the response." } : item));
      }
      setState("idle");
    } catch (error) {
      setEntries((current) => [...current, { id: crypto.randomUUID(), transcript: "", language: "unknown", error: error instanceof Error ? error.message : "Voice request failed.", at: new Date() }]);
      setState("error");
    }
  }, [chat, synthesize, transcribe]);

  const toggle = useCallback(async () => {
    if (state === "recording") { recorder.current?.stop(); return; }
    if (state !== "idle" && state !== "error") return;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const next = new MediaRecorder(stream.current, { mimeType });
      chunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = () => { stream.current?.getTracks().forEach((track) => track.stop()); processAudio(new Blob(chunks.current, { type: mimeType }), mimeType); };
      recorder.current = next; next.start(); setState("recording");
    } catch { setState("error"); }
  }, [processAudio, state]);

  const play = (url: string) => { audio.current?.pause(); const next = new Audio(url); next.playbackRate = speed; audio.current = next; next.play().then(() => setState("speaking")).catch(() => setState("idle")); next.onended = () => setState("idle"); };

  return <section className="mx-auto flex h-[calc(100vh-10rem)] min-h-[560px] max-w-4xl flex-col overflow-hidden rounded-[var(--radius-panel)]" style={{ background: "var(--app-card-glass)", border: "1px solid var(--app-border)", boxShadow: "var(--shadow-glass)" }}>
    <header className="flex items-center justify-between border-b px-5 py-4 md:px-7" style={{ borderColor: "var(--app-border)" }}><div><p className="text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: "var(--app-primary)" }}>Same Select2Notion AI</p><h1 className="mt-1 text-xl font-bold" style={{ color: "var(--app-text)" }}>Voice Assistant</h1></div><span className="rounded-full px-3 py-1 text-xs" style={{ color: "var(--app-muted-color)", background: "color-mix(in srgb, var(--app-primary) 10%, transparent)" }}>Text + voice</span></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 md:p-7" aria-live="polite">
      {entries.length === 0 && <div className="mx-auto mt-12 max-w-sm text-center"><AudioLines className="mx-auto mb-4" style={{ color: "var(--app-primary)" }} /><p className="font-medium" style={{ color: "var(--app-text)" }}>Ask about your journal naturally.</p><p className="mt-2 text-sm leading-7" style={{ color: "var(--app-muted-color)" }}>Myanmar, English, and mixed-language speech are transcribed before being sent to the same AI chat session.</p></div>}
      {entries.map((entry) => (
        <article key={entry.id} className="space-y-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-7" style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}><Mic className="mr-2 inline" size={13}/>{entry.transcript || "Voice request"}</div>
          {entry.reply && <div className="max-w-[88%] rounded-2xl rounded-tl-sm border px-4 py-3 text-sm leading-7" style={{ background: "var(--app-card)", borderColor: "var(--app-border)", color: "var(--app-text)" }}><p>{entry.reply}</p>{entry.audioUrl && <div className="mt-3 flex items-center gap-3"><button aria-label="Play AI response" onClick={() => play(entry.audioUrl!)} className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}><Play size={16}/></button><Volume2 size={15} style={{ color: "var(--app-muted-color)" }}/><span className="text-xs" style={{ color: "var(--app-muted-color)" }}>{entry.language}</span></div>}{entry.error && <p className="mt-3 text-xs" style={{ color: "var(--app-muted-color)" }}>{entry.error}</p>}</div>}
          {entry.error && !entry.reply && <p className="text-sm" style={{ color: "var(--app-danger)" }}>{entry.error}</p>}
        </article>
      ))}
    </div>
    <footer className="border-t p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center" style={{ borderColor: "var(--app-border)" }}><div className="mb-3 flex justify-center gap-1">{[0.75,1,1.25,1.5,2].map((value) => <button key={value} onClick={() => setSpeed(value)} className="rounded px-2 py-1 text-[11px]" style={{ color: speed === value ? "var(--app-primary-fg)" : "var(--app-muted-color)", background: speed === value ? "var(--app-primary)" : "transparent" }}>{value}×</button>)}</div><motion.button aria-label={state === "recording" ? "Stop voice input" : "Start voice input"} onClick={toggle} animate={reducedMotion ? {} : state === "recording" ? { scale: [1, 1.05, 1] } : { scale: 1 }} transition={{ duration: .9, repeat: state === "recording" ? Infinity : 0 }} className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: state === "recording" ? "var(--app-danger)" : "var(--app-primary)", color: "var(--app-primary-fg)", boxShadow: "0 0 0 8px color-mix(in srgb, var(--app-primary) 10%, transparent)" }}>{state === "transcribing" || state === "thinking" ? <Loader2 className="animate-spin"/> : state === "recording" ? <MicOff/> : <Mic/>}</motion.button><p className="mt-3 text-sm" style={{ color: "var(--app-muted-color)" }}>{stateLabel[state]}</p></footer>
  </section>;
}
