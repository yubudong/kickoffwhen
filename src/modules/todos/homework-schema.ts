import { sql } from 'drizzle-orm';
import { pgTable,uuid,text,integer,timestamp,jsonb,unique,foreignKey,check,index } from 'drizzle-orm/pg-core';
import { todoTasks,todoSubmissions,todoReviews } from './schema';
import { guardians } from '@/modules/families/schema';
import type { ReviewDocument } from './homework-types';
export const homeworkUploads=pgTable('homework_uploads',{
 id:uuid('id').primaryKey(),todoId:uuid('todo_id').notNull(),familyId:uuid('family_id').notNull(),childId:uuid('child_id').notNull(),commandId:uuid('command_id').notNull(),sha256:text('sha256').notNull(),mimeType:text('mime_type').notNull(),byteSize:integer('byte_size').notNull(),width:integer('width').notNull(),height:integer('height').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('homework_upload_command_unique').on(t.todoId,t.commandId),foreignKey({name:'homework_upload_task_scope_fk',columns:[t.familyId,t.childId,t.todoId],foreignColumns:[todoTasks.familyId,todoTasks.childId,todoTasks.id]}).onDelete('cascade'),check('homework_upload_values_check',sql`${t.mimeType} in ('image/jpeg','image/png','image/webp') and ${t.byteSize}>0 and ${t.byteSize}<=8388608 and ${t.width}>0 and ${t.height}>0 and ${t.width}::bigint*${t.height}<=32000000 and ${t.sha256} ~ '^[a-f0-9]{64}$'`),index('homework_upload_scope_idx').on(t.familyId,t.childId,t.todoId)]);
export const homeworkSubmissionDetails=pgTable('homework_submission_details',{
 submissionId:uuid('submission_id').primaryKey().references(()=>todoSubmissions.id,{onDelete:'cascade'}),todoId:uuid('todo_id').notNull().references(()=>todoTasks.id,{onDelete:'cascade'}),commandId:uuid('command_id').notNull(),inputFingerprint:text('input_fingerprint').notNull(),note:text('note').notNull().default(''),
},t=>[unique('homework_submit_command_unique').on(t.todoId,t.commandId)]);
export const homeworkPages=pgTable('homework_pages',{
 id:uuid('id').primaryKey().defaultRandom(),submissionId:uuid('submission_id').notNull().references(()=>todoSubmissions.id,{onDelete:'cascade'}),pageKey:uuid('page_key').notNull(),attachmentId:uuid('attachment_id').notNull(),mimeType:text('mime_type').notNull(),byteSize:integer('byte_size').notNull(),rotation:integer('rotation').notNull().default(0),parentPageKey:uuid('parent_page_key'),position:integer('position').notNull(),
},t=>[unique('homework_pages_position_unique').on(t.submissionId,t.position),unique('homework_pages_key_unique').on(t.submissionId,t.pageKey),check('homework_page_values_check',sql`${t.rotation} in (0,90,180,270) and ${t.position} between 0 and 19 and ${t.byteSize}>0`),index('homework_pages_attachment_idx').on(t.attachmentId)]);
export const homeworkReviewDrafts=pgTable('homework_review_drafts',{
 id:uuid('id').primaryKey().defaultRandom(),todoId:uuid('todo_id').notNull().references(()=>todoTasks.id,{onDelete:'cascade'}),submissionNumber:integer('submission_number').notNull(),guardianId:uuid('guardian_id').notNull().references(()=>guardians.id),revision:integer('revision').notNull(),document:jsonb('document').$type<ReviewDocument>().notNull(),commandId:uuid('command_id').notNull(),inputFingerprint:text('input_fingerprint').notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('homework_draft_round_unique').on(t.todoId,t.submissionNumber),check('homework_draft_values_check',sql`${t.revision}>0 and ${t.submissionNumber}>0`)]);
export const homeworkReviewSnapshots=pgTable('homework_review_snapshots',{
 reviewId:uuid('review_id').primaryKey().references(()=>todoReviews.id,{onDelete:'cascade'}),todoId:uuid('todo_id').notNull().references(()=>todoTasks.id,{onDelete:'cascade'}),commandId:uuid('command_id').notNull(),inputFingerprint:text('input_fingerprint').notNull(),document:jsonb('document').$type<ReviewDocument>().notNull(),
},t=>[unique('homework_review_command_unique').on(t.todoId,t.commandId)]);
