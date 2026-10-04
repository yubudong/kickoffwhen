export type OcrLine = { text: string; confidence: number; order: number };

export interface OcrProvider {
  read(input: {
    bytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png";
  }): Promise<OcrLine[]>;
}
