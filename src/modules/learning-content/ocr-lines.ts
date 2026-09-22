import { z } from "zod";

export const ocrLinesSchema = z
  .array(
    z.object({
      text: z.string().trim().min(1).max(500),
      confidence: z.number().min(0).max(1),
      order: z.number().int().min(0),
    }),
  )
  .max(500);
