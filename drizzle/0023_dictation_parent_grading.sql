CREATE TABLE "dictation_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"photos" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"marks" jsonb,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "dictation_submissions_command_unique" UNIQUE("session_id","command_id"),
	CONSTRAINT "dictation_submissions_status_check" CHECK ("dictation_submissions"."status" in ('pending', 'reviewed')),
	CONSTRAINT "dictation_submissions_photos_check" CHECK (jsonb_typeof("dictation_submissions"."photos") = 'array' and jsonb_array_length("dictation_submissions"."photos") between 1 and 4),
	CONSTRAINT "dictation_submissions_review_check" CHECK (("dictation_submissions"."status" = 'pending' and "dictation_submissions"."reviewed_by" is null and "dictation_submissions"."reviewed_at" is null and "dictation_submissions"."marks" is null) or ("dictation_submissions"."status" = 'reviewed' and "dictation_submissions"."reviewed_by" is not null and "dictation_submissions"."reviewed_at" is not null and "dictation_submissions"."marks" is not null))
);
--> statement-breakpoint
ALTER TABLE "dictation_commands" DROP CONSTRAINT "dictation_commands_type_check";--> statement-breakpoint
ALTER TABLE "dictation_sessions" DROP CONSTRAINT "dictation_sessions_phase_check";--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "grading_mode" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "dictation_submissions" ADD CONSTRAINT "dictation_submissions_session_scope_fk" FOREIGN KEY ("family_id","child_id","session_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_submissions" ADD CONSTRAINT "dictation_submissions_reviewer_scope_fk" FOREIGN KEY ("family_id","reviewed_by") REFERENCES "public"."guardians"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictation_submissions_one_pending" ON "dictation_submissions" USING btree ("session_id") WHERE "dictation_submissions"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_grading_mode_check" CHECK ("learning_tasks"."grading_mode" in ('self', 'parent'));--> statement-breakpoint
ALTER TABLE "dictation_commands" ADD CONSTRAINT "dictation_commands_type_check" CHECK ("dictation_commands"."command_type" in ('playback', 'grading', 'restart', 'submission'));--> statement-breakpoint
ALTER TABLE "dictation_sessions" ADD CONSTRAINT "dictation_sessions_phase_check" CHECK ("dictation_sessions"."phase" in ('listening', 'grading', 'awaiting_parent', 'completed'));