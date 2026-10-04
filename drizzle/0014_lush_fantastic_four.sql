ALTER TABLE "review_events" DROP CONSTRAINT "review_events_source_event_fk";
--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "command_id" uuid;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "input_fingerprint" text;--> statement-breakpoint
UPDATE "review_events"
SET
	"command_id" = "id",
	"input_fingerprint" = md5("id"::text) || md5('legacy-review:' || "id"::text)
WHERE "command_id" IS NULL OR "input_fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "command_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "input_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_scope_id_unique" UNIQUE("family_id","child_id","card_id","id");--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_source_scope_fk" FOREIGN KEY ("family_id","child_id","card_id","source_review_event_id") REFERENCES "public"."review_events"("family_id","child_id","card_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_events_scope_command_unique" ON "review_events" USING btree ("family_id","child_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_events_source_once_unique" ON "review_events" USING btree ("source_review_event_id") WHERE "review_events"."source_review_event_id" is not null;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_relearning_shape_check" CHECK ("review_events"."event_type" <> 'same_session_relearning' or ("review_events"."correct" = true and "review_events"."fsrs_rating" = 3));--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_input_fingerprint_check" CHECK ("review_events"."input_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE FUNCTION enforce_relearning_source_invariant() RETURNS trigger AS $$
BEGIN
	IF NEW.event_type = 'same_session_relearning' AND NOT EXISTS (
		SELECT 1
		FROM review_events source
		WHERE source.id = NEW.source_review_event_id
			AND source.family_id = NEW.family_id
			AND source.child_id = NEW.child_id
			AND source.card_id = NEW.card_id
			AND source.event_type IN ('new_first', 'scheduled_first')
			AND source.correct = false
	) THEN
		RAISE EXCEPTION 'RELEARNING_SOURCE_INVARIANT_INVALID';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER review_events_relearning_source_invariant_trigger
BEFORE INSERT OR UPDATE OF family_id, child_id, card_id, event_type, correct, fsrs_rating, source_review_event_id ON review_events
FOR EACH ROW EXECUTE FUNCTION enforce_relearning_source_invariant();
