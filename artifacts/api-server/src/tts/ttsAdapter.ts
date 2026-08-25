import type { AIConfig } from "../lib/aiEngine.js";
import { OpenAITTSProvider } from "./providers/openAITTS.js";
import type { TTSInput, TTSResult } from "./ttsTypes.js";

/** Output adapter only: it never performs AI reasoning or accesses user data. */
export async function synthesizeSpeech(config: AIConfig, input: TTSInput): Promise<TTSResult> {
  if (config.provider === "openai") return new OpenAITTSProvider(config.apiKey).synthesize(input);
  // Do not pretend Gemini TTS is available until a provider/model is explicitly configured and verified.
  throw new Error("UNSUPPORTED_LANGUAGE");
}
