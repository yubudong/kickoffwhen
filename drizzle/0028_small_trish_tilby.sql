CREATE TABLE "habit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"habit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_versions_habit_id_version_unique" UNIQUE("habit_id","version"),
	CONSTRAINT "habit_versions_family_id_command_id_unique" UNIQUE("family_id","command_id"),
	CONSTRAINT "habit_version_positive" CHECK ("habit_versions"."version">0)
);
--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "habit_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "habit_versions" ADD CONSTRAINT "habit_versions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_versions" ADD CONSTRAINT "habit_versions_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_versions" ADD CONSTRAINT "habit_versions_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE habits SET updated_at=created_at;--> statement-breakpoint
INSERT INTO habit_versions (family_id,child_id,habit_id,version,command_id,effective_from,config,created_at)
SELECT family_id,child_id,id,1,command_id,start_date,jsonb_build_object('title',title,'requirements',requirements,'schedule',schedule,'weekdays',weekdays,'weeklyTarget',weekly_target,'confirmation',confirmation,'coins',coins,'growth',growth),created_at FROM habits;--> statement-breakpoint
UPDATE todo_tasks t SET habit_revision_id=v.id FROM habit_versions v WHERE t.habit_id=v.habit_id AND v.version=1;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_habit_revision_id_habit_versions_id_fk" FOREIGN KEY ("habit_revision_id") REFERENCES "public"."habit_versions"("id") ON DELETE no action ON UPDATE no action;