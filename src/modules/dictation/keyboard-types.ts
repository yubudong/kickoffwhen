import { z } from 'zod';
import { englishDetailsSchema,englishListeningHintsSchema,englishSpellingRulesSchema,englishWritingHintSchema } from '@/modules/learning-content/english-types';
export const responseModeSchema=z.enum(['paper','keyboard']);
export const keyboardSnapshotSchema=z.object({version:z.literal(1),answer:z.string().min(1).max(500),rules:englishSpellingRulesSchema,variants:z.array(z.string().max(500)).max(20),manualReview:z.boolean(),writingHint:englishWritingHintSchema,hints:englishListeningHintsSchema.optional(),details:englishDetailsSchema.optional()}).strict();
export type KeyboardSnapshot=z.infer<typeof keyboardSnapshotSchema>;
export const keyboardResultSchema=z.object({itemId:z.string().uuid(),input:z.string().max(500),status:z.enum(['correct','incorrect','pending']),reason:z.enum(['match','blank','case','spacing','spelling','variant','manual']),correct:z.boolean().nullable()}).strict();
export type KeyboardResult=z.infer<typeof keyboardResultSchema>;
export const keyboardAnswerSchema=z.object({itemId:z.string().uuid(),input:z.string().max(500)}).strict();
const commandBase={commandId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),roundNumber:z.number().int().positive()};
export const keyboardCommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('draft'),...commandBase,draftRevision:z.number().int().nonnegative(),cursor:z.number().int().nonnegative(),answers:z.array(keyboardAnswerSchema).max(200)}).strict(),
 z.object({type:z.literal('submit'),...commandBase,draftRevision:z.number().int().nonnegative(),answers:z.array(keyboardAnswerSchema).min(1).max(200)}).strict(),
 z.object({type:z.literal('advance'),...commandBase}).strict(),
]);
export type KeyboardCommand=z.infer<typeof keyboardCommandSchema>;
export const keyboardReviewSchema=z.object({...commandBase,sessionId:z.string().uuid(),decisions:z.array(z.object({itemId:z.string().uuid(),correct:z.boolean()}).strict()).min(1).max(200),note:z.string().trim().min(1).max(500)}).strict();
export const keyboardViewSchema=z.object({
 draft:z.object({revision:z.number().int().nonnegative(),cursor:z.number().int().nonnegative(),answers:z.array(keyboardAnswerSchema),savedAt:z.string().nullable()}).strict().optional(),
 result:z.object({roundNumber:z.number().int().positive(),pending:z.boolean(),submittedAt:z.string(),reviewNote:z.string().nullable(),items:z.array(keyboardResultSchema.extend({answerText:z.string(),english:englishDetailsSchema.optional()}))}).strict().optional(),
 summary:z.object({total:z.number().int(),firstCorrect:z.number().int(),firstIncorrect:z.number().int(),firstPending:z.number().int(),corrected:z.number().int(),rounds:z.number().int(),assisted:z.boolean()}).strict(),
}).strict();
export type KeyboardView=z.infer<typeof keyboardViewSchema>;
export const keyboardReasonLabel:Record<KeyboardResult['reason'],string>={match:'与目标写法一致',blank:'本题未作答',case:'请核对必要的大小写',spacing:'请核对词语之间的空格',spelling:'请核对字母、时态、复数或连字符',variant:'另一种规范写法，待家长确认',manual:'这题需要家长核对目标写法'};
