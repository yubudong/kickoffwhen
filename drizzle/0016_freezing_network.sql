CREATE TABLE "dictation_answer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"task_item_id" uuid NOT NULL,
	"correct" boolean NOT NULL,
	"event_role" text NOT NULL,
	"review_event_id" uuid,
	"replay_count" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dictation_answer_command_item_unique" UNIQUE("session_id","command_id","task_item_id"),
	CONSTRAINT "dictation_answer_round_check" CHECK ("dictation_answer_events"."round_number" >= 1),
	CONSTRAINT "dictation_answer_role_check" CHECK ("dictation_answer_events"."event_role" in ('first_pass', 'continued_error', 'same_session_relearning')),
	CONSTRAINT "dictation_answer_replay_check" CHECK ("dictation_answer_events"."replay_count" >= 1),
	CONSTRAINT "dictation_answer_review_shape_check" CHECK (("dictation_answer_events"."event_role" = 'continued_error' and "dictation_answer_events"."review_event_id" is null) or ("dictation_answer_events"."event_role" <> 'continued_error' and "dictation_answer_events"."review_event_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "dictation_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dictation_commands_type_check" CHECK ("dictation_commands"."command_type" in ('playback', 'grading')),
	CONSTRAINT "dictation_commands_fingerprint_check" CHECK ("dictation_commands"."input_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dictation_commands_version_check" CHECK ("dictation_commands"."resulting_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "dictation_completion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text DEFAULT 'LearningTaskCompleted' NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dictation_completion_session_unique" UNIQUE("session_id"),
	CONSTRAINT "dictation_completion_task_unique" UNIQUE("task_id"),
	CONSTRAINT "dictation_completion_type_check" CHECK ("dictation_completion_events"."event_type" = 'LearningTaskCompleted')
);
--> statement-breakpoint
CREATE TABLE "dictation_playback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"task_item_id" uuid NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dictation_playback_command_item_unique" UNIQUE("session_id","command_id","task_item_id"),
	CONSTRAINT "dictation_playback_round_check" CHECK ("dictation_playback_events"."round_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "dictation_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"item_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "dictation_rounds_scope_number_unique" UNIQUE("session_id","round_number"),
	CONSTRAINT "dictation_rounds_number_check" CHECK ("dictation_rounds"."round_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "dictation_session_items" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_item_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"first_correct" boolean,
	"final_correct" boolean DEFAULT false NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"first_review_event_id" uuid,
	CONSTRAINT "dictation_session_items_pk" PRIMARY KEY("family_id","child_id","session_id","task_item_id"),
	CONSTRAINT "dictation_session_items_session_task_item_unique" UNIQUE("session_id","task_item_id"),
	CONSTRAINT "dictation_session_items_kind_check" CHECK ("dictation_session_items"."kind" in ('due_review', 'new')),
	CONSTRAINT "dictation_session_items_position_check" CHECK ("dictation_session_items"."position" >= 0),
	CONSTRAINT "dictation_session_items_replay_check" CHECK ("dictation_session_items"."replay_count" >= 0),
	CONSTRAINT "dictation_session_items_first_review_check" CHECK (("dictation_session_items"."first_correct" is null and "dictation_session_items"."first_review_event_id" is null) or ("dictation_session_items"."first_correct" is not null and "dictation_session_items"."first_review_event_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "dictation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phase" text DEFAULT 'listening' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"current_round_item_ids" jsonb NOT NULL,
	"played_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"marked_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_pass_marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latest_marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "dictation_sessions_family_child_id_unique" UNIQUE("family_id","child_id","id"),
	CONSTRAINT "dictation_sessions_scope_task_unique" UNIQUE("family_id","child_id","task_id"),
	CONSTRAINT "dictation_sessions_mode_check" CHECK ("dictation_sessions"."mode" in ('continuous_batch', 'item_by_item')),
	CONSTRAINT "dictation_sessions_status_check" CHECK ("dictation_sessions"."status" in ('active', 'completed', 'cancelled')),
	CONSTRAINT "dictation_sessions_phase_check" CHECK ("dictation_sessions"."phase" in ('listening', 'grading', 'completed')),
	CONSTRAINT "dictation_sessions_version_check" CHECK ("dictation_sessions"."version" >= 0),
	CONSTRAINT "dictation_sessions_round_check" CHECK ("dictation_sessions"."round_number" >= 1),
	CONSTRAINT "dictation_sessions_lifecycle_check" CHECK ((
        ("dictation_sessions"."status" = 'active' and "dictation_sessions"."completed_at" is null and "dictation_sessions"."cancelled_at" is null and "dictation_sessions"."phase" <> 'completed') or
        ("dictation_sessions"."status" = 'completed' and "dictation_sessions"."completed_at" is not null and "dictation_sessions"."cancelled_at" is null and "dictation_sessions"."phase" = 'completed') or
        ("dictation_sessions"."status" = 'cancelled' and "dictation_sessions"."cancelled_at" is not null and "dictation_sessions"."completed_at" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "dictation_answer_events" ADD CONSTRAINT "dictation_answer_events_review_event_id_review_events_id_fk" FOREIGN KEY ("review_event_id") REFERENCES "public"."review_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_answer_events" ADD CONSTRAINT "dictation_answer_item_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","task_item_id") REFERENCES "public"."dictation_session_items"("family_id","child_id","session_id","task_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_commands" ADD CONSTRAINT "dictation_commands_session_scope_fk" FOREIGN KEY ("family_id","child_id","session_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_completion_events" ADD CONSTRAINT "dictation_completion_session_scope_fk" FOREIGN KEY ("family_id","child_id","session_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_completion_events" ADD CONSTRAINT "dictation_completion_task_scope_fk" FOREIGN KEY ("family_id","child_id","task_id") REFERENCES "public"."learning_tasks"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_playback_events" ADD CONSTRAINT "dictation_playback_item_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","task_item_id") REFERENCES "public"."dictation_session_items"("family_id","child_id","session_id","task_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_rounds" ADD CONSTRAINT "dictation_rounds_session_scope_fk" FOREIGN KEY ("family_id","child_id","session_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_task_item_id_learning_task_items_id_fk" FOREIGN KEY ("task_item_id") REFERENCES "public"."learning_task_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_first_review_event_id_review_events_id_fk" FOREIGN KEY ("first_review_event_id") REFERENCES "public"."review_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_session_scope_fk" FOREIGN KEY ("family_id","child_id","session_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_task_scope_fk" FOREIGN KEY ("family_id","child_id","task_id") REFERENCES "public"."learning_tasks"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_sessions" ADD CONSTRAINT "dictation_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_sessions" ADD CONSTRAINT "dictation_sessions_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_sessions" ADD CONSTRAINT "dictation_sessions_task_scope_fk" FOREIGN KEY ("family_id","child_id","task_id") REFERENCES "public"."learning_tasks"("family_id","child_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dictation_answer_session_idx" ON "dictation_answer_events" USING btree ("session_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "dictation_commands_session_command_unique" ON "dictation_commands" USING btree ("session_id","command_id");--> statement-breakpoint
CREATE INDEX "dictation_playback_session_idx" ON "dictation_playback_events" USING btree ("session_id","round_number");--> statement-breakpoint
CREATE INDEX "dictation_sessions_child_status_idx" ON "dictation_sessions" USING btree ("family_id","child_id","status");--> statement-breakpoint
CREATE FUNCTION reject_dictation_fact_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'DICTATION_FACT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_answer_events_immutable_trigger
BEFORE UPDATE ON dictation_answer_events
FOR EACH ROW EXECUTE FUNCTION reject_dictation_fact_update();--> statement-breakpoint
CREATE TRIGGER dictation_playback_events_immutable_trigger
BEFORE UPDATE ON dictation_playback_events
FOR EACH ROW EXECUTE FUNCTION reject_dictation_fact_update();--> statement-breakpoint
CREATE TRIGGER dictation_completion_events_immutable_trigger
BEFORE UPDATE ON dictation_completion_events
FOR EACH ROW EXECUTE FUNCTION reject_dictation_fact_update();--> statement-breakpoint
CREATE TRIGGER dictation_commands_immutable_trigger
BEFORE UPDATE ON dictation_commands
FOR EACH ROW EXECUTE FUNCTION reject_dictation_fact_update();--> statement-breakpoint
CREATE FUNCTION protect_dictation_session_item_facts() RETURNS trigger AS $$
BEGIN
	IF OLD.family_id <> NEW.family_id
		OR OLD.child_id <> NEW.child_id
		OR OLD.session_id <> NEW.session_id
		OR OLD.task_item_id <> NEW.task_item_id
		OR OLD.task_id <> NEW.task_id
		OR OLD.card_id <> NEW.card_id
		OR OLD.kind <> NEW.kind
		OR OLD.position <> NEW.position
		OR (OLD.first_correct IS NOT NULL AND OLD.first_correct IS DISTINCT FROM NEW.first_correct)
		OR (OLD.first_review_event_id IS NOT NULL AND OLD.first_review_event_id IS DISTINCT FROM NEW.first_review_event_id)
	THEN
		RAISE EXCEPTION 'DICTATION_FIRST_PASS_IMMUTABLE';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_session_items_first_pass_trigger
BEFORE UPDATE ON dictation_session_items
FOR EACH ROW EXECUTE FUNCTION protect_dictation_session_item_facts();--> statement-breakpoint
CREATE FUNCTION protect_dictation_session_first_pass() RETURNS trigger AS $$
BEGIN
	IF NOT (OLD.first_pass_marks <@ NEW.first_pass_marks)
		OR OLD.family_id <> NEW.family_id
		OR OLD.child_id <> NEW.child_id
		OR OLD.task_id <> NEW.task_id
		OR OLD.mode <> NEW.mode
	THEN
		RAISE EXCEPTION 'DICTATION_FIRST_PASS_IMMUTABLE';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_sessions_first_pass_trigger
BEFORE UPDATE ON dictation_sessions
FOR EACH ROW EXECUTE FUNCTION protect_dictation_session_first_pass();--> statement-breakpoint
CREATE FUNCTION protect_dictation_round_facts() RETURNS trigger AS $$
BEGIN
	IF OLD.family_id <> NEW.family_id
		OR OLD.child_id <> NEW.child_id
		OR OLD.session_id <> NEW.session_id
		OR OLD.round_number <> NEW.round_number
		OR OLD.item_ids IS DISTINCT FROM NEW.item_ids
		OR (OLD.completed_at IS NOT NULL AND OLD.completed_at IS DISTINCT FROM NEW.completed_at)
	THEN
		RAISE EXCEPTION 'DICTATION_ROUND_IMMUTABLE';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_rounds_facts_trigger
BEFORE UPDATE ON dictation_rounds
FOR EACH ROW EXECUTE FUNCTION protect_dictation_round_facts();--> statement-breakpoint
CREATE FUNCTION validate_dictation_session_item_scope() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM learning_task_items item
		WHERE item.id = NEW.task_item_id
			AND item.task_id = NEW.task_id
			AND item.family_id = NEW.family_id
			AND item.child_id = NEW.child_id
			AND item.card_id = NEW.card_id
			AND item.kind = NEW.kind
			AND item.position = NEW.position
	) THEN
		RAISE EXCEPTION 'DICTATION_TASK_ITEM_SCOPE_INVALID';
	END IF;
	IF NEW.first_review_event_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM review_events review
		WHERE review.id = NEW.first_review_event_id
			AND review.family_id = NEW.family_id
			AND review.child_id = NEW.child_id
			AND review.card_id = NEW.card_id
			AND review.event_type IN ('new_first', 'scheduled_first')
	) THEN
		RAISE EXCEPTION 'DICTATION_FIRST_REVIEW_SCOPE_INVALID';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_session_items_scope_trigger
BEFORE INSERT OR UPDATE ON dictation_session_items
FOR EACH ROW EXECUTE FUNCTION validate_dictation_session_item_scope();--> statement-breakpoint
CREATE FUNCTION validate_dictation_answer_review_scope() RETURNS trigger AS $$
DECLARE
	item_card_id uuid;
BEGIN
	SELECT card_id INTO item_card_id
	FROM dictation_session_items
	WHERE family_id = NEW.family_id
		AND child_id = NEW.child_id
		AND session_id = NEW.session_id
		AND task_item_id = NEW.task_item_id;
	IF item_card_id IS NULL THEN
		RAISE EXCEPTION 'DICTATION_ANSWER_ITEM_SCOPE_INVALID';
	END IF;
	IF NEW.review_event_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM review_events review
		WHERE review.id = NEW.review_event_id
			AND review.family_id = NEW.family_id
			AND review.child_id = NEW.child_id
			AND review.card_id = item_card_id
	) THEN
		RAISE EXCEPTION 'DICTATION_REVIEW_SCOPE_INVALID';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_answer_review_scope_trigger
BEFORE INSERT OR UPDATE ON dictation_answer_events
FOR EACH ROW EXECUTE FUNCTION validate_dictation_answer_review_scope();
