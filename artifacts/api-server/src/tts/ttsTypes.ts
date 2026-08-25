export type SupportedLanguage = "myanmar" | "english" | "mixed" | "unknown";

export interface TTSInput {
  text: string;
  language: SupportedLanguage;
  voice?: string;
  speed?: number;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  language: SupportedLanguage;
}

export interface TTSProvider {
  synthesize(input: TTSInput): Promise<TTSResult>;
}
