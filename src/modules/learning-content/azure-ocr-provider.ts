import { z } from "zod";

import type { OcrLine, OcrProvider } from "./ocr-provider";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const responseSchema = z.object({
  readResult: z.object({
    blocks: z.array(
      z.object({
        lines: z.array(
          z.object({
            text: z.string(),
            words: z
              .array(
                z.object({
                  text: z.string(),
                  confidence: z.number().min(0).max(1),
                }),
              )
              .optional(),
          }),
        ),
      }),
    ),
  }),
});

export class AzureOcrProvider implements OcrProvider {
  constructor(
    private readonly endpoint: string,
    private readonly key: string,
    private readonly request: FetchLike = fetch,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async read(input: {
    bytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png";
  }): Promise<OcrLine[]> {
    let response: Response;
    try {
      const url = new URL(
        `${this.endpoint.replace(/\/$/, "")}/computervision/imageanalysis:analyze`,
      );
      url.searchParams.set("api-version", "2024-02-01");
      url.searchParams.set("features", "read");
      response = await this.request(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": input.mimeType,
        },
        body: input.bytes as BodyInit,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new Error("OCR_UPSTREAM_UNAVAILABLE");
    }
    if (!response.ok) throw new Error(`OCR_UPSTREAM_${response.status}`);

    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await response.json());
    } catch {
      throw new Error("OCR_INVALID_RESPONSE");
    }

    return parsed.readResult.blocks.flatMap((block) => block.lines).map(
      (line, order): OcrLine => {
        const confidences = line.words?.map((word) => word.confidence) ?? [];
        const confidence = confidences.length
          ? Math.round(
              (confidences.reduce((sum, value) => sum + value, 0) /
                confidences.length) *
                1_000_000,
            ) / 1_000_000
          : 0;
        return { text: line.text, confidence, order };
      },
    );
  }
}
