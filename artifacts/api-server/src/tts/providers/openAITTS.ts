import type { TTSInput, TTSProvider, TTSResult } from "../ttsTypes.js";

export class OpenAITTSProvider implements TTSProvider {
  constructor(private readonly apiKey: string) {}

  async synthesize(input: TTSInput): Promise<TTSResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: input.voice ?? "coral",
          input: input.text,
          response_format: "mp3",
          speed: Math.min(2, Math.max(0.25, input.speed ?? 1)),
        }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("TTS_AUTH_ERROR");
        if (response.status === 429) throw new Error("RATE_LIMITED");
        throw new Error("TTS_ERROR");
      }
      return { audio: Buffer.from(await response.arrayBuffer()), mimeType: "audio/mpeg", language: input.language };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("NETWORK_TIMEOUT");
      throw error;
    } finally { clearTimeout(timeout); }
  }
}
