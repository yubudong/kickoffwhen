import { AzureTtsProvider } from "@/modules/learning-content/azure-tts-provider";
import type { TtsProvider } from "@/modules/learning-content/tts-provider";

// One production worker: stay below F0's 20 requests per 60 seconds.
const REQUEST_GAP_MS = 3_100;

export function createConfiguredTtsProvider(
  source: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): TtsProvider | undefined {
  if (source.AZURE_SPEECH_ENABLED !== "true") return undefined;
  const endpoint = source.AZURE_SPEECH_ENDPOINT?.trim() ?? "";
  const key = source.AZURE_SPEECH_KEY?.trim();
  if (!/^https:\/\/[a-z0-9-]+\.tts\.speech\.microsoft\.com\/?$/.test(endpoint) || !key) {
    throw new Error("TTS_CONFIGURATION_INVALID");
  }
  const provider = new AzureTtsProvider(endpoint, key, request);
  let nextRequestAt = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    synthesize(input) {
      const result = queue.then(async () => {
        const delay = nextRequestAt - Date.now();
        if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        try {
          return await provider.synthesize(input);
        } finally {
          nextRequestAt = Date.now() + REQUEST_GAP_MS;
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
