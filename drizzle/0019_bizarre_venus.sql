CREATE TABLE "todo_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"submission_number" integer NOT NULL,
	"guardian_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_reviews_todo_id_submission_number_unique" UNIQUE("todo_id","submission_number"),
	CONSTRAINT "todo_review_decision" CHECK ("todo_reviews"."decision" in ('approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "todo_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"base_points" integer DEFAULT 1 NOT NULL,
	"bonus_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_rewards_todo_id_unique" UNIQUE("todo_id"),
	CONSTRAINT "todo_reward_points" CHECK ("todo_rewards"."base_points"=1 and "todo_rewards"."bonus_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "todo_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"attachment_id" uuid,
	"mime_type" text,
	"byte_size" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_submissions_attachment_id_unique" UNIQUE("attachment_id"),
	CONSTRAINT "todo_submissions_todo_id_number_unique" UNIQUE("todo_id","number")
);
--> statement-breakpoint
CREATE TABLE "todo_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"title" text NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"dictation_task_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"submission_number" integer DEFAULT 0 NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_tasks_dictation_task_id_unique" UNIQUE("dictation_task_id"),
	CONSTRAINT "todo_tasks_family_id_command_id_unique" UNIQUE("family_id","command_id"),
	CONSTRAINT "todo_tasks_family_id_child_id_id_unique" UNIQUE("family_id","child_id","id"),
	CONSTRAINT "todo_status" CHECK ("todo_tasks"."status" in ('open','submitted','approved','rejected')),
	CONSTRAINT "todo_kind" CHECK (("todo_tasks"."kind"='manual' and "todo_tasks"."dictation_task_id" is null) or ("todo_tasks"."kind"='dictation' and "todo_tasks"."dictation_task_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "todo_reviews" ADD CONSTRAINT "todo_reviews_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_reviews" ADD CONSTRAINT "todo_reviews_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_rewards" ADD CONSTRAINT "todo_rewards_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_submissions" ADD CONSTRAINT "todo_submissions_todo_id_todo_tasks_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_dictation_task_id_learning_tasks_id_fk" FOREIGN KEY ("dictation_task_id") REFERENCES "public"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_family_id_guardian_id_guardians_family_id_id_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO todo_tasks (family_id, child_id, guardian_id, command_id, title, requirements, date, kind, dictation_task_id, status, submission_number, created_at, updated_at)
SELECT family_id, child_id, guardian_id, id, '今日听写', '完成全部听写及错题订正，完成后自动提交家长审核。', (created_at AT TIME ZONE 'Asia/Shanghai')::date, 'dictation', id, CASE WHEN status='completed' THEN 'submitted' ELSE 'open' END, CASE WHEN status='completed' THEN 1 ELSE 0 END, created_at, coalesce(completed_at, created_at)
FROM learning_tasks WHERE status IN ('active','completed') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO todo_submissions (todo_id, number, submitted_at) SELECT id, 1, updated_at FROM todo_tasks WHERE status='submitted' AND submission_number=1 ON CONFLICT DO NOTHING;
