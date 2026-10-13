import { z } from "zod";

export const dictationPhotoSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().positive().max(8 * 1024 * 1024),
}).strict();
export type DictationPhoto = z.infer<typeof dictationPhotoSchema>;

// Future AI adapters return proposals only. Applying marks still requires an
// authenticated parent's confirmation through the normal grading service.
export interface DictationGradingProvider {
  propose(input: {
    sessionId: string;
    roundNumber: number;
    photos: Array<{ bytes: Uint8Array; mimeType: DictationPhoto["mimeType"] }>;
    items: Array<{ itemId: string; answerText: string }>;
  }, signal: AbortSignal): Promise<{
    provider: string;
    model: string;
    marks: Array<{ itemId: string; correct: boolean | null; confidence: number; note?: string }>;
  }>;
}

export type ParentDictationReview = {
  sessionId: string;
  childName: string;
  version: number;
  roundNumber: number;
  submittedAt: string;
  photos: DictationPhoto[];
  items: Array<{ itemId: string; position: number; answerText: string }>;
};
