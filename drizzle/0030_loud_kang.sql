CREATE TABLE "homework_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"page_key" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"parent_page_key" uuid,
	"position" integer NOT NULL,
	CONSTRAINT "homework_pages_position_unique" UNIQUE("submission_id","position"),
	CONSTRAINT "homework_pages_key_unique" UNIQUE("submission_id","page_key"),
	CONSTRAINT "homework_page_values_check" CHECK ("homework_pages"."rotation" in (0,90,180,270) and "homework_pages"."position" between 0 and 19 and "homework_pages"."byte_size">0)
);
--> statement-breakpoint
CREATE TABLE "homework_review_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"submission_number" integer NOT NULL,
	"guardian_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"document" jsonb NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_draft_round_unique" UNIQUE("todo_id","submission_number"),
	CONSTRAINT "homework_draft_values_check" CHECK ("homework_review_drafts"."revision">0 and "homework_review_drafts"."submission_number">0)
);
--> statement-breakpoint
CREATE TABLE "homework_review_snapshots" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"todo_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "homework_review_command_unique" UNIQUE("todo_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "homework_submission_details" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"todo_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "homework_submit_command_unique" UNIQUE("todo_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "homework_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"todo_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_upload_command_unique" UNIQUE("todo_id","command_id"),
	CONSTRAINT "homework_upload_values_check" CHECK ("homework_uploads"."mime_type" in ('image/jpeg','image/png','image/webp') and "homework_uploads"."byte_size">0 and "homework_uploads"."byte_size"<=8388608 and "homework_uploads"."width">0 and "homework_uploads"."height">0 and "homework_uploads"."width"::bigint*"homework_uploads"."height"<=32000000 and "homework_uploads"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "homework_pages" ADD CONSTRAINT "homework_pages_submission_id_todo_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."todo_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_review_drafts" ADD CONSTRAINT "homework_review_drafts_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_review_drafts" ADD CONSTRAINT "homework_review_drafts_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_review_snapshots" ADD CONSTRAINT "homework_review_snapshots_review_id_todo_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."todo_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_review_snapshots" ADD CONSTRAINT "homework_review_snapshots_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_details" ADD CONSTRAINT "homework_submission_details_submission_id_todo_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."todo_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_details" ADD CONSTRAINT "homework_submission_details_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_uploads" ADD CONSTRAINT "homework_upload_task_scope_fk" FOREIGN KEY ("family_id","child_id","todo_id") REFERENCES "public"."todo_tasks"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_pages_attachment_idx" ON "homework_pages" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "homework_upload_scope_idx" ON "homework_uploads" USING btree ("family_id","child_id","todo_id");