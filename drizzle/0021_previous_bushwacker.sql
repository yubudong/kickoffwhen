ALTER TABLE "todo_tasks" DROP CONSTRAINT "todo_status";--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "title" text DEFAULT '今日听写' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD COLUMN "batch_command_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_section_id_textbook_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."textbook_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_tasks_batch_idx" ON "learning_tasks" USING btree ("family_id","batch_command_id");--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_origin_check" CHECK ("learning_tasks"."origin" in ('manual', 'curriculum', 'extra_practice', 'auto_review'));--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_status" CHECK ("todo_tasks"."status" in ('open','submitted','approved','rejected','cancelled'));