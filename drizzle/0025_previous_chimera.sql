CREATE TABLE "companion_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"species" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_memories_child_id_stage_unique" UNIQUE("child_id","stage")
);
--> statement-breakpoint
CREATE TABLE "companions" (
	"child_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"species" text NOT NULL,
	"name" text NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"appearance" text DEFAULT 'animal' NOT NULL,
	"human_style" text DEFAULT 'girl' NOT NULL,
	"equipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "companion_rules" CHECK ("companions"."species" in ('dragon','fox','phoenix') and "companions"."stage" between 0 and 3 and "companions"."appearance" in ('animal','human') and "companions"."human_style" in ('boy','girl'))
);
--> statement-breakpoint
CREATE TABLE "family_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"repeatable" boolean DEFAULT true NOT NULL,
	"weekly_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_rewards_family_id_command_id_unique" UNIQUE("family_id","command_id"),
	CONSTRAINT "reward_rules" CHECK ("family_rewards"."price" between 1 and 1000000 and ("family_rewards"."weekly_limit" is null or "family_rewards"."weekly_limit" between 1 and 100))
);
--> statement-breakpoint
CREATE TABLE "growth_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"percent" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "growth_boosts_child_id_item_key_unique" UNIQUE("child_id","item_key"),
	CONSTRAINT "boost_rules" CHECK ("growth_boosts"."percent" between 1 and 30 and "growth_boosts"."expires_at">"growth_boosts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "growth_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"growth" integer DEFAULT 0 NOT NULL,
	"fed" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_entries_child_id_source_key_unique" UNIQUE("child_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"title" text NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"schedule" text NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weekly_target" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"stopped_on" date,
	"confirmation" text DEFAULT 'parent' NOT NULL,
	"coins" integer DEFAULT 1 NOT NULL,
	"growth" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_family_id_command_id_unique" UNIQUE("family_id","command_id"),
	CONSTRAINT "habit_rules" CHECK ("habits"."schedule" in ('daily','weekdays','weekly') and "habits"."confirmation" in ('self','parent') and "habits"."weekly_target" between 1 and 7 and "habits"."coins" between 0 and 10000 and "habits"."growth" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "companion_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "companion_inventory_child_id_item_key_unique" UNIQUE("child_id","item_key"),
	CONSTRAINT "inventory_nonnegative" CHECK ("companion_inventory"."quantity">=0)
);
--> statement-breakpoint
CREATE TABLE "family_reward_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"title" text NOT NULL,
	"price" integer NOT NULL,
	"week" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_reward_requests_child_id_command_id_unique" UNIQUE("child_id","command_id"),
	CONSTRAINT "reward_request_rules" CHECK ("family_reward_requests"."price">0 and "family_reward_requests"."status" in ('pending','approved','completed','rejected','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "growth_wallets" (
	"child_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"growth" integer DEFAULT 0 NOT NULL,
	"fed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "wallet_nonnegative" CHECK ("growth_wallets"."coins">=0 and "growth_wallets"."held">=0 and "growth_wallets"."coins">="growth_wallets"."held" and "growth_wallets"."growth">=0 and "growth_wallets"."fed">=0)
);
--> statement-breakpoint
ALTER TABLE "todo_rewards" DROP CONSTRAINT "todo_reward_points";--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "habit_id" uuid;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "confirmation" text DEFAULT 'parent' NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "reward_coins" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "reward_growth" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD COLUMN "submitted_boost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companion_memories" ADD CONSTRAINT "companion_memories_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_memories" ADD CONSTRAINT "companion_memories_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_rewards" ADD CONSTRAINT "family_rewards_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_boosts" ADD CONSTRAINT "growth_boosts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_boosts" ADD CONSTRAINT "growth_boosts_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_entries" ADD CONSTRAINT "growth_entries_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_entries" ADD CONSTRAINT "growth_entries_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_inventory" ADD CONSTRAINT "companion_inventory_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_inventory" ADD CONSTRAINT "companion_inventory_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_reward_requests" ADD CONSTRAINT "family_reward_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_reward_requests" ADD CONSTRAINT "family_reward_requests_reward_id_family_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."family_rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_reward_requests" ADD CONSTRAINT "family_reward_requests_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_wallets" ADD CONSTRAINT "growth_wallets_family_id_child_id_children_family_id_id_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_tasks_habit_id_occurrence_date_unique" UNIQUE("habit_id","occurrence_date");--> statement-breakpoint
ALTER TABLE "todo_rewards" ADD CONSTRAINT "todo_reward_points" CHECK ("todo_rewards"."base_points" between 0 and 10000 and "todo_rewards"."bonus_points" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "todo_tasks" ADD CONSTRAINT "todo_reward_config" CHECK ("todo_tasks"."reward_coins" between 0 and 10000 and "todo_tasks"."reward_growth" between 0 and 10000 and "todo_tasks"."submitted_boost" between 0 and 30 and "todo_tasks"."confirmation" in ('self','parent') and ("todo_tasks"."kind"<>'dictation' or "todo_tasks"."confirmation"='parent'));--> statement-breakpoint
-- Historical points become star coins exactly once; historical growth is not inferred.
INSERT INTO growth_entries (family_id,child_id,source_key,kind,coins,details,created_at)
SELECT t.family_id,t.child_id,'todo:'||t.id::text,'historical_points',r.base_points+r.bonus_points,jsonb_build_object('todoId',t.id,'ratio','1:1'),r.created_at
FROM todo_rewards r JOIN todo_tasks t ON t.id=r.todo_id
ON CONFLICT (child_id,source_key) DO NOTHING;--> statement-breakpoint
INSERT INTO growth_wallets (family_id,child_id,coins)
SELECT family_id,child_id,sum(coins)::integer FROM growth_entries GROUP BY family_id,child_id
ON CONFLICT (child_id) DO NOTHING;