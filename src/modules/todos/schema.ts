import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, date, integer, timestamp, unique, foreignKey, check } from 'drizzle-orm/pg-core';
import { children, families, guardians } from '@/modules/families/schema';
import { learningTasks } from '@/modules/dictation/task-schema';
export const todoTasks = pgTable('todo_tasks', {
    id: uuid('id').primaryKey().defaultRandom(), familyId: uuid('family_id').notNull().references(() => families.id), childId: uuid('child_id').notNull(), guardianId: uuid('guardian_id').notNull(), commandId: uuid('command_id').notNull(),
    title: text('title').notNull(), requirements: text('requirements').notNull().default(''), date: date('date').notNull(), kind: text('kind').notNull().default('manual'), dictationTaskId: uuid('dictation_task_id').unique().references(() => learningTasks.id),
    status: text('status').notNull().default('open'), submissionNumber: integer('submission_number').notNull().default(0), reviewNote: text('review_note').notNull().default(''), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.familyId, t.commandId), unique().on(t.familyId, t.childId, t.id), foreignKey({ columns: [t.familyId, t.childId], foreignColumns: [children.familyId, children.id] }), foreignKey({ columns: [t.familyId, t.guardianId], foreignColumns: [guardians.familyId, guardians.id] }), check('todo_status', sql `${t.status} in ('open','submitted','approved','rejected')`), check('todo_kind', sql `(${t.kind}='manual' and ${t.dictationTaskId} is null) or (${t.kind}='dictation' and ${t.dictationTaskId} is not null)`)]);
export const todoSubmissions = pgTable('todo_submissions', {
    id: uuid('id').primaryKey().defaultRandom(), todoId: uuid('todo_id').notNull().references(() => todoTasks.id), number: integer('number').notNull(), attachmentId: uuid('attachment_id').unique(), mimeType: text('mime_type'), byteSize: integer('byte_size'), submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.todoId, t.number)]);
export const todoReviews = pgTable('todo_reviews', {
    id: uuid('id').primaryKey().defaultRandom(), todoId: uuid('todo_id').notNull().references(() => todoTasks.id), submissionNumber: integer('submission_number').notNull(), guardianId: uuid('guardian_id').notNull().references(() => guardians.id), decision: text('decision').notNull(), note: text('note').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.todoId, t.submissionNumber), check('todo_review_decision', sql `${t.decision} in ('approved','rejected')`)]);
export const todoRewards = pgTable('todo_rewards', {
    id: uuid('id').primaryKey().defaultRandom(), todoId: uuid('todo_id').notNull().unique().references(() => todoTasks.id), basePoints: integer('base_points').notNull().default(1), bonusPoints: integer('bonus_points').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('todo_reward_points', sql `${t.basePoints}=1 and ${t.bonusPoints} between 0 and 10000`)]);
