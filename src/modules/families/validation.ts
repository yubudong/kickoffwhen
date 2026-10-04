import { z } from "zod";

const trimmedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const createFamilyOwnerInputSchema = z.object({
  familyName: trimmedText(1, 80),
  ownerName: trimmedText(1, 40),
});

export const createChildInputSchema = z.object({
  nickname: trimmedText(1, 24),
  avatarKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
  grade: z.number().int().min(1).max(12),
  textbookEditionIds: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  childPin: z.string().regex(/^\d{6}$/).optional(),
});

export const parentPinSchema = z.string().regex(/^\d{6}$/);

export const parentPinInputSchema = z.object({
  pin: parentPinSchema,
});

export type CreateFamilyOwnerInput = z.infer<
  typeof createFamilyOwnerInputSchema
>;
export type CreateChildInput = z.input<typeof createChildInputSchema>;
