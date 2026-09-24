export type TtsInput = {
  text: string;
  language: "zh-CN" | "en-US";
  voice: "zh-CN-XiaoxiaoNeural" | "en-US-JennyNeural";
  rate: number;
};

export interface TtsProvider {
  synthesize(
    input: TtsInput,
  ): Promise<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>;
}
