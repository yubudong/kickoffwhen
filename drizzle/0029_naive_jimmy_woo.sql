CREATE TABLE "dictation_keyboard_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"results" jsonb NOT NULL,
	"status" text NOT NULL,
	"decisions" jsonb,
	"review_command_id" uuid,
	"review_fingerprint" text,
	"reviewed_by" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"advance_command_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "keyboard_attempts_round_unique" UNIQUE("session_id","round_number"),
	CONSTRAINT "keyboard_attempts_command_unique" UNIQUE("session_id","command_id"),
	CONSTRAINT "keyboard_attempts_status_check" CHECK ("dictation_keyboard_attempts"."status" in ('pending','resolved')),
	CONSTRAINT "keyboard_attempts_results_check" CHECK (jsonb_typeof("dictation_keyboard_attempts"."results")='array' and jsonb_array_length("dictation_keyboard_attempts"."results")>0),
	CONSTRAINT "keyboard_attempts_review_check" CHECK (("dictation_keyboard_attempts"."reviewed_by" is null and "dictation_keyboard_attempts"."decisions" is null and "dictation_keyboard_attempts"."reviewed_at" is null) or ("dictation_keyboard_attempts"."reviewed_by" is not null and "dictation_keyboard_attempts"."decisions" is not null and "dictation_keyboard_attempts"."reviewed_at" is not null and "dictation_keyboard_attempts"."review_command_id" is not null and "dictation_keyboard_attempts"."review_note" is not null)),
	CONSTRAINT "keyboard_attempts_applied_check" CHECK (("dictation_keyboard_attempts"."applied_at" is null and "dictation_keyboard_attempts"."advance_command_id" is null) or ("dictation_keyboard_attempts"."applied_at" is not null and "dictation_keyboard_attempts"."advance_command_id" is not null and "dictation_keyboard_attempts"."status"='resolved'))
);
--> statement-breakpoint
CREATE TABLE "dictation_keyboard_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"answers" jsonb NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyboard_drafts_round_unique" UNIQUE("session_id","round_number"),
	CONSTRAINT "keyboard_drafts_values_check" CHECK ("dictation_keyboard_drafts"."revision">0 and "dictation_keyboard_drafts"."cursor">=0 and jsonb_typeof("dictation_keyboard_drafts"."answers")='array')
);
--> statement-breakpoint
ALTER TABLE "learning_task_items" ADD COLUMN "keyboard_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "response_mode" text DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE "dictation_keyboard_attempts" ADD CONSTRAINT "keyboard_attempts_round_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number") REFERENCES "public"."dictation_rounds"("family_id","child_id","session_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_keyboard_attempts" ADD CONSTRAINT "keyboard_attempts_parent_scope_fk" FOREIGN KEY ("family_id","reviewed_by") REFERENCES "public"."guardians"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_keyboard_drafts" ADD CONSTRAINT "keyboard_drafts_round_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number") REFERENCES "public"."dictation_rounds"("family_id","child_id","session_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keyboard_attempts_parent_pending_idx" ON "dictation_keyboard_attempts" USING btree ("family_id","status","submitted_at");--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_response_mode_check" CHECK ("learning_tasks"."response_mode" in ('paper','keyboard') and ("learning_tasks"."response_mode"='paper' or ("learning_tasks"."mode"='continuous_batch' and "learning_tasks"."grading_mode"='self')));