CREATE TABLE "todo_task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"reward_coins" integer DEFAULT 1 NOT NULL,
	"reward_growth" integer DEFAULT 10 NOT NULL,
	"confirmation" text DEFAULT 'parent' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_command_id" uuid NOT NULL,
	"last_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "todo_template_family_command_unique" UNIQUE("family_id","command_id"),
	CONSTRAINT "todo_template_fields_check" CHECK (length(btrim("todo_task_templates"."title")) between 1 and 120 and length("todo_task_templates"."requirements")<=2000 and "todo_task_templates"."reward_coins" between 0 and 10000 and "todo_task_templates"."reward_growth" between 0 and 10000 and "todo_task_templates"."confirmation" in ('self','parent') and "todo_task_templates"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "todo_task_templates" ADD CONSTRAINT "todo_task_templates_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_task_templates" ADD CONSTRAINT "todo_template_guardian_scope_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_template_family_active_idx" ON "todo_task_templates" USING btree ("family_id","deleted_at","updated_at");