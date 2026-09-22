import { describe, expect, test } from "vitest";

import {
  AzureTtsProvider,
  buildSafeSsml,
} from "@/modules/learning-content/azure-tts-provider";
import { AzureOcrProvider } from "@/modules/learning-content/azure-ocr-provider";

describe("Azure TTS adapter", () => {
  test("SSML转义正文并绑定语言、声音和语速", () => {
    expect(
      buildSafeSsml({
        text: `甲<乙>&\"丙\"'丁'`,
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 0.85,
      }),
    ).toBe(
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural"><prosody rate="85%">甲&lt;乙&gt;&amp;&quot;丙&quot;&apos;丁&apos;</prosody></voice></speak>`,
    );
  });

  test("拒绝语言与声音不匹配", () => {
    expect(() =>
      buildSafeSsml({
        text: "hello",
        language: "zh-CN",
        voice: "en-US-JennyNeural",
        rate: 1,
      }),
    ).toThrow("TTS_VOICE_LANGUAGE_MISMATCH");
  });

  test("上游错误只暴露状态码而不泄露密钥或正文", async () => {
    const key = "top-secret-subscription-key";
    const text = "不应出现在错误中的正文";
    const provider = new AzureTtsProvider(
      "https://speech.example.test",
      key,
      async () => new Response(`${key}:${text}`, { status: 503 }),
    );

    const error = await provider
      .synthesize({
        text,
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 1,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("TTS_UPSTREAM_503");
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).not.toContain(text);
  });

  test("请求超时明显短于worker租约且错误保持脱敏", async () => {
    const provider = new AzureTtsProvider(
      "https://speech.example.test",
      "test-key",
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("secret")), {
            once: true,
          });
        }),
      5,
    );

    await expect(
      provider.synthesize({
        text: "不会泄露",
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 1,
      }),
    ).rejects.toThrow("TTS_UPSTREAM_UNAVAILABLE");
  });
});

describe("Azure Vision OCR adapter", () => {
  test("解析Image Analysis 4.0阅读行并按响应顺序编号", async () => {
    const provider = new AzureOcrProvider(
      "https://vision.example.test",
      "vision-key",
      async () =>
        Response.json({
          readResult: {
            blocks: [
              {
                lines: [
                  {
                    text: "mountain",
                    words: [
                      { text: "mountain", confidence: 0.98 },
                    ],
                  },
                  {
                    text: "河流",
                    words: [
                      { text: "河", confidence: 0.9 },
                      { text: "流", confidence: 0.8 },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    );

    await expect(
      provider.read({
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: "image/jpeg",
      }),
    ).resolves.toEqual([
      { text: "mountain", confidence: 0.98, order: 0 },
      { text: "河流", confidence: 0.85, order: 1 },
    ]);
  });

  test("OCR上游错误与畸形响应均脱敏", async () => {
    const key = "private-vision-key";
    const provider = new AzureOcrProvider(
      "https://vision.example.test",
      key,
      async () => new Response(`bad ${key}`, { status: 429 }),
    );
    const malformed = new AzureOcrProvider(
      "https://vision.example.test",
      key,
      async () => Response.json({ readResult: { blocks: "secret-body" } }),
    );

    await expect(
      provider.read({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    ).rejects.toThrow("OCR_UPSTREAM_429");
    await expect(
      malformed.read({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    ).rejects.toThrow("OCR_INVALID_RESPONSE");
  });

  test("OCR请求超时明显短于worker租约且错误保持脱敏", async () => {
    const provider = new AzureOcrProvider(
      "https://vision.example.test",
      "test-key",
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("secret")), {
            once: true,
          });
        }),
      5,
    );

    await expect(
      provider.read({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    ).rejects.toThrow("OCR_UPSTREAM_UNAVAILABLE");
  });
});
