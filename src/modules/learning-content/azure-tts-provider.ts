import type { TtsInput, TtsProvider } from "./tts-provider";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const VOICE_BY_LANGUAGE: Record<TtsInput["language"], TtsInput["voice"]> = {
  "zh-CN": "zh-CN-XiaoxiaoNeural",
  "en-US": "en-US-JennyNeural",
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSafeSsml(input: TtsInput): string {
  if (VOICE_BY_LANGUAGE[input.language] !== input.voice) {
    throw new Error("TTS_VOICE_LANGUAGE_MISMATCH");
  }
  if (!Number.isFinite(input.rate) || input.rate < 0.5 || input.rate > 2) {
    throw new Error("TTS_RATE_INVALID");
  }
  if (!input.text.trim() || input.text.length > 500) {
    throw new Error("TTS_TEXT_INVALID");
  }

  const rate = `${Math.round(input.rate * 100)}%`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${input.language}"><voice name="${input.voice}"><prosody rate="${rate}">${escapeXml(input.text)}</prosody></voice></speak>`;
}

export class AzureTtsProvider implements TtsProvider {
  constructor(
    private readonly endpoint: string,
    private readonly key: string,
    private readonly request: FetchLike = fetch,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async synthesize(input: TtsInput) {
    let response: Response;
    try {
      response = await this.request(
        `${this.endpoint.replace(/\/$/, "")}/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": this.key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat":
              "audio-16khz-128kbitrate-mono-mp3",
            "User-Agent": "family-learning-mvp",
          },
          body: buildSafeSsml(input),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        },
      );
    } catch {
      throw new Error("TTS_UPSTREAM_UNAVAILABLE");
    }
    if (!response.ok) throw new Error(`TTS_UPSTREAM_${response.status}`);

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: "audio/mpeg" as const,
    };
  }
}
