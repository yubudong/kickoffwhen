import { afterEach, expect, test, vi } from "vitest";
import { createConfiguredTtsProvider } from "@/worker/tts-runtime";

const input = { text: "苹果", language: "zh-CN", voice: "zh-CN-XiaoxiaoNeural", rate: 1 } as const;
const config = {
  AZURE_SPEECH_ENABLED: "true",
  AZURE_SPEECH_ENDPOINT: "https://eastus.tts.speech.microsoft.com",
  AZURE_SPEECH_KEY: "test-only-key",
};
afterEach(() => vi.useRealTimers());

test("没有显式启用时不消费待生成语音任务", () => {
  expect(createConfiguredTtsProvider({})).toBeUndefined();
});

test("启用但配置不完整时拒绝启动且不泄露配置", () => {
  expect(() => createConfiguredTtsProvider({ AZURE_SPEECH_ENABLED: "true" })).toThrow("TTS_CONFIGURATION_INVALID");
  expect(() => createConfiguredTtsProvider({ ...config, AZURE_SPEECH_ENDPOINT: "https://untrusted.example" })).toThrow("TTS_CONFIGURATION_INVALID");
});

test("运行时使用 Azure 合成并返回可缓存音频", async () => {
  const provider = createConfiguredTtsProvider(config, async (url, init) => {
    expect(url).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key")).toBe("test-only-key");
    expect(init?.body).toContain("苹果");
    return new Response(new Uint8Array([73, 68, 51]));
  });
  await expect(provider?.synthesize(input)).resolves.toEqual({ bytes: new Uint8Array([73, 68, 51]), mimeType: "audio/mpeg" });
});

test("连续生成即使上次失败也限速以保护 F0 配额", async () => {
  vi.useFakeTimers();
  const times: number[] = [];
  const provider = createConfiguredTtsProvider(config, async () => {
    times.push(Date.now());
    return times.length === 1 ? new Response(null, { status: 429 }) : new Response(new Uint8Array([73, 68, 51]));
  })!;
  await expect(provider.synthesize(input)).rejects.toThrow("TTS_UPSTREAM_429");
  const next = provider.synthesize(input);
  await vi.advanceTimersByTimeAsync(3000);
  expect(times).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(100);
  await next;
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(3100);
});
