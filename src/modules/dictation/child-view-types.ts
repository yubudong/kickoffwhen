import { z } from "zod";

const uuidSchema = z.string().uuid();

export const childTaskSummarySchema = z.object({
  taskId: uuidSchema,
  sessionId: uuidSchema.nullable(),
  itemCount: z.number().int().positive(),
  mode: z.enum(["continuous_batch", "item_by_item"]),
  audioStatus: z.enum(["ready", "preparing"]),
}).strict();

const sessionBaseSchema = z.object({
  sessionId: uuidSchema,
  taskId: uuidSchema,
  familyId: uuidSchema,
  childId: uuidSchema,
  version: z.number().int().nonnegative(),
  phase: z.enum(["listening", "grading", "completed"]),
  mode: z.enum(["continuous_batch", "item_by_item"]),
  roundNumber: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  playedItemIds: z.array(uuidSchema),
  intervalSeconds: z.number().int().min(2).max(120),
  repeatCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  speechRate: z.number().min(0.5).max(2),
  allowManualReplay: z.boolean(),
});

const listeningItemSchema = z.object({
  itemId: uuidSchema,
  position: z.number().int().nonnegative(),
  audioUrl: z.string().regex(/^\/api\/private-media\/[0-9a-f-]+$/),
  pinyinText: z.string().nullable(),
  contextText: z.string().nullable(),
}).strict();

const gradingItemSchema = z.object({
  itemId: uuidSchema,
  position: z.number().int().nonnegative(),
  answerText: z.string().min(1),
}).strict();

const todoSubmissionSchema = z.object({
  id: uuidSchema,
  date: z.iso.date(),
  number: z.number().int().nonnegative(),
  status: z.enum(["open", "submitted", "approved", "rejected", "cancelled"]),
}).strict();

export const listeningSessionViewSchema = sessionBaseSchema.extend({
  phase: z.literal("listening"),
  items: z.array(listeningItemSchema).min(1),
}).strict();

export const gradingSessionViewSchema = sessionBaseSchema.extend({
  phase: z.literal("grading"),
  items: z.array(gradingItemSchema).min(1),
}).strict();

export const completedSessionViewSchema = sessionBaseSchema.extend({
  phase: z.literal("completed"),
  items: z.array(z.never()).length(0),
  todoSubmission: todoSubmissionSchema.nullable(),
}).strict();

export const childSessionViewSchema = z.discriminatedUnion("phase", [
  listeningSessionViewSchema,
  gradingSessionViewSchema,
  completedSessionViewSchema,
]);

export type ChildTaskSummary = z.infer<typeof childTaskSummarySchema>;
export type ChildSessionView = z.infer<typeof childSessionViewSchema>;
export type ListeningSessionView = z.infer<typeof listeningSessionViewSchema>;
export type GradingSessionView = z.infer<typeof gradingSessionViewSchema>;
