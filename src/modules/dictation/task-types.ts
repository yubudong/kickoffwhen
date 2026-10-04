import { z } from "zod";

export const buildTaskInputSchema = z.object({
  childId: z.string().uuid(),
  subject: z.enum(["chinese", "english"]).optional(),
  newCardIds: z.array(z.string().uuid()).max(100),
  commandId: z.string().uuid(),
  maxReviewCards: z.number().int().min(0).max(100),
  mode: z.enum(["continuous_batch", "item_by_item"]),
  order: z.enum(["source", "random"]),
  intervalSeconds: z.number().int().min(2).max(120),
  repeatCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  speechRate: z.number().finite().min(0.5).max(2),
  allowManualReplay: z.boolean(),
}).strict();

export type BuildTaskInput = z.infer<typeof buildTaskInputSchema>;

export const buildTaskBatchInputSchema = buildTaskInputSchema.omit({
  newCardIds: true,
  maxReviewCards: true,
}).extend({
  subject: z.enum(["chinese", "english"]),
  sectionIds: z.array(z.string().uuid()).max(30),
  extraCardIds: z.array(z.string().uuid()).max(100),
}).strict();

export type BuildTaskBatchInput = z.infer<typeof buildTaskBatchInputSchema>;

export const learningTaskItemSchema = z.object({
  cardId: z.string().uuid(),
  kind: z.enum(["due_review", "new", "manual_review"]),
  position: z.number().int().min(0),
  ttsDedupeKey: z.string().min(1).max(500),
  audioStatus: z.enum(["queued", "ready"]),
  mediaId: z.string().uuid().nullable(),
}).strict();

export const learningTaskSchema = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
  mode: buildTaskInputSchema.shape.mode,
  order: buildTaskInputSchema.shape.order,
  intervalSeconds: buildTaskInputSchema.shape.intervalSeconds,
  repeatCount: buildTaskInputSchema.shape.repeatCount,
  speechRate: buildTaskInputSchema.shape.speechRate,
  allowManualReplay: buildTaskInputSchema.shape.allowManualReplay,
  maxReviewCards: buildTaskInputSchema.shape.maxReviewCards,
  audioStatus: z.enum(["preparing", "ready"]),
  items: z.array(learningTaskItemSchema),
}).strict();

export const parentTaskPostResponseSchema = z.object({
  task: learningTaskSchema,
}).strict();

export const parentTaskBatchPostResponseSchema = z.object({
  tasks: z.array(learningTaskSchema).min(1),
}).strict();

export type LearningTaskItem = z.infer<typeof learningTaskItemSchema>;
export type LearningTask = z.infer<typeof learningTaskSchema>;
export type ParentTaskPostResponse = z.infer<typeof parentTaskPostResponseSchema>;
export type ParentTaskBatchPostResponse = z.infer<typeof parentTaskBatchPostResponseSchema>;
