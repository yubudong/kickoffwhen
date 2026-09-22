import { z } from "zod";
import { State, type Card } from "ts-fsrs";

const dateSchema = z.union([z.date(), z.string(), z.number()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_FSRS_DATE");
  return date;
});

export const fsrsCardSchema = z.object({
  due: dateSchema,
  stability: z.number().finite().nonnegative(),
  difficulty: z.number().finite().nonnegative(),
  elapsed_days: z.number().finite().nonnegative(),
  scheduled_days: z.number().finite().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.nativeEnum(State),
  last_review: dateSchema.optional(),
});

export const reviewEventTypeSchema = z.enum([
  "new_first",
  "scheduled_first",
  "same_session_relearning",
]);

export type ReviewEventType = z.infer<typeof reviewEventTypeSchema>;

export function parseFsrsCard(value: unknown): Card {
  return fsrsCardSchema.parse(value) as Card;
}

export function serializeFsrsCard(card: Card): Record<string, unknown> {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review?.toISOString(),
  };
}
