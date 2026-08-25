# Voice Assistant Architecture Audit

## Reused architecture

- `POST /api/ai/voice` and `transcribeAudio` remain the sole STT path.
- `POST /api/ai/chat` remains the sole AI, intent-classification, and Notion-tool path.
- `requireAuth` remains the sole identity source; Firebase UID is derived from the verified bearer token.
- Existing user AI configuration and existing server-side Notion credentials remain authoritative.
- Existing Upstash Redis wrapper is extended with `session:{uid}` conversation memory at a two-hour TTL.

## Additive components

- `src/tts/ttsAdapter.ts` selects an output-only TTS provider without coupling TTS to reasoning.
- `src/tts/providers/openAITTS.ts` uses the authenticated user's existing OpenAI key server-side.
- `src/lib/redisSessionManager.ts` holds the bounded shared conversation history.
- `VoiceAssistant.tsx` is a new voice-first UI surface. It records with the browser, calls existing STT, then calls existing chat and optionally requests TTS.

## Intentionally not duplicated

- No VoiceBrain, intent engine, Notion client, user credential store, Firebase auth layer, or STT provider was introduced.
- Raw voice audio is not persisted.

## Current provider behavior

- OpenAI configurations can synthesize MP3 through the TTS adapter.
- Gemini configurations return a structured, non-blocking unavailable response until a Gemini TTS model is explicitly configured and verified.
- Text responses always remain the authoritative result.

## Verification

- API server TypeScript: pass.
- Trading journal TypeScript: pass.
- API server production build: pass.
- Trading journal production build: pass.
