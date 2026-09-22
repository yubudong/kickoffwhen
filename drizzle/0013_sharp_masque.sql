CREATE TABLE "learning_task_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"card_family_id" uuid,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"tts_dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_task_items_task_position_unique" UNIQUE("task_id","position"),
	CONSTRAINT "learning_task_items_task_card_unique" UNIQUE("task_id","card_id"),
	CONSTRAINT "learning_task_items_card_family_check" CHECK ("learning_task_items"."card_family_id" is null or "learning_task_items"."card_family_id" = "learning_task_items"."family_id"),
	CONSTRAINT "learning_task_items_kind_check" CHECK ("learning_task_items"."kind" in ('due_review', 'new')),
	CONSTRAINT "learning_task_items_position_check" CHECK ("learning_task_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"mode" text NOT NULL,
	"task_order" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"repeat_count" integer NOT NULL,
	"speech_rate" numeric(4, 2) NOT NULL,
	"allow_manual_replay" boolean NOT NULL,
	"max_review_cards" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "learning_tasks_family_child_id_unique" UNIQUE("family_id","child_id","id"),
	CONSTRAINT "learning_tasks_mode_check" CHECK ("learning_tasks"."mode" in ('continuous_batch', 'item_by_item')),
	CONSTRAINT "learning_tasks_order_check" CHECK ("learning_tasks"."task_order" in ('source', 'random')),
	CONSTRAINT "learning_tasks_interval_check" CHECK ("learning_tasks"."interval_seconds" between 2 and 120),
	CONSTRAINT "learning_tasks_repeat_check" CHECK ("learning_tasks"."repeat_count" between 1 and 3),
	CONSTRAINT "learning_tasks_speech_rate_check" CHECK ("learning_tasks"."speech_rate" between 0.5 and 2),
	CONSTRAINT "learning_tasks_review_cap_check" CHECK ("learning_tasks"."max_review_cards" between 0 and 100),
	CONSTRAINT "learning_tasks_status_check" CHECK ("learning_tasks"."status" in ('active', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "child_card_states" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"card_json" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_card_states_family_child_card_pk" PRIMARY KEY("family_id","child_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"correct" boolean NOT NULL,
	"fsrs_rating" integer NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"card_json" jsonb NOT NULL,
	"source_review_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_type_check" CHECK ("review_events"."event_type" in ('new_first', 'scheduled_first', 'same_session_relearning')),
	CONSTRAINT "review_events_rating_check" CHECK ("review_events"."fsrs_rating" in (1, 3)),
	CONSTRAINT "review_events_relearning_source_check" CHECK ((
        ("review_events"."event_type" = 'same_session_relearning' and "review_events"."source_review_event_id" is not null)
        or
        ("review_events"."event_type" <> 'same_session_relearning' and "review_events"."source_review_event_id" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_family_id_id_unique" UNIQUE("family_id","id");--> statement-breakpoint
ALTER TABLE "learning_task_items" ADD CONSTRAINT "learning_task_items_card_id_learning_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."learning_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_task_items" ADD CONSTRAINT "learning_task_items_task_scope_fk" FOREIGN KEY ("family_id","child_id","task_id") REFERENCES "public"."learning_tasks"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_task_items" ADD CONSTRAINT "learning_task_items_custom_card_scope_fk" FOREIGN KEY ("card_family_id","card_id") REFERENCES "public"."learning_cards"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_family_guardian_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_card_states" ADD CONSTRAINT "child_card_states_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_card_states" ADD CONSTRAINT "child_card_states_card_id_learning_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."learning_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_card_states" ADD CONSTRAINT "child_card_states_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_card_id_learning_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."learning_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_source_event_fk" FOREIGN KEY ("source_review_event_id") REFERENCES "public"."review_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_task_items_tts_dedupe_idx" ON "learning_task_items" USING btree ("tts_dedupe_key");--> statement-breakpoint
CREATE INDEX "learning_task_items_child_idx" ON "learning_task_items" USING btree ("family_id","child_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_tasks_family_command_unique" ON "learning_tasks" USING btree ("family_id","command_id");--> statement-breakpoint
CREATE INDEX "learning_tasks_child_status_idx" ON "learning_tasks" USING btree ("family_id","child_id","status");--> statement-breakpoint
CREATE INDEX "child_card_states_due_idx" ON "child_card_states" USING btree ("family_id","child_id","due_at");--> statement-breakpoint
CREATE INDEX "review_events_child_reviewed_idx" ON "review_events" USING btree ("family_id","child_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_events_card_idx" ON "review_events" USING btree ("family_id","child_id","card_id");--> statement-breakpoint
ALTER TABLE "private_media" ADD CONSTRAINT "private_media_family_child_id_unique" UNIQUE("family_id","child_id","id");--> statement-breakpoint
CREATE FUNCTION enforce_learning_card_family_scope() RETURNS trigger AS $$
DECLARE
	stored_family_id uuid;
	stored_source text;
BEGIN
	SELECT family_id, source INTO stored_family_id, stored_source
	FROM learning_cards
	WHERE id = NEW.card_id;

	IF NOT FOUND OR NOT (
		(stored_family_id = NEW.family_id)
		OR (stored_family_id IS NULL AND stored_source = 'builtin')
	) THEN
		RAISE EXCEPTION 'LEARNING_CARD_FAMILY_SCOPE_INVALID';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER learning_task_items_card_scope_trigger
BEFORE INSERT OR UPDATE OF family_id, card_id, card_family_id ON learning_task_items
FOR EACH ROW EXECUTE FUNCTION enforce_learning_card_family_scope();--> statement-breakpoint
CREATE TRIGGER child_card_states_card_scope_trigger
BEFORE INSERT OR UPDATE OF family_id, card_id ON child_card_states
FOR EACH ROW EXECUTE FUNCTION enforce_learning_card_family_scope();--> statement-breakpoint
CREATE TRIGGER review_events_card_scope_trigger
BEFORE INSERT OR UPDATE OF family_id, card_id ON review_events
FOR EACH ROW EXECUTE FUNCTION enforce_learning_card_family_scope();
