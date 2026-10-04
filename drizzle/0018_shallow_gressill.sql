ALTER TABLE "dictation_answer_events" DROP CONSTRAINT "dictation_answer_round_item_fk";
--> statement-breakpoint
ALTER TABLE "dictation_playback_events" DROP CONSTRAINT "dictation_playback_round_item_fk";
--> statement-breakpoint
ALTER TABLE "dictation_answer_events" ADD CONSTRAINT "dictation_answer_round_item_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number","task_item_id") REFERENCES "public"."dictation_round_items"("family_id","child_id","session_id","round_number","task_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_playback_events" ADD CONSTRAINT "dictation_playback_round_item_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number","task_item_id") REFERENCES "public"."dictation_round_items"("family_id","child_id","session_id","round_number","task_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION validate_dictation_round_member() RETURNS trigger AS $$
DECLARE
	expected_item_id text;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'DICTATION_ROUND_MEMBER_IMMUTABLE';
	END IF;
	SELECT round.item_ids ->> NEW.position
	INTO expected_item_id
	FROM dictation_rounds round
	WHERE round.family_id = NEW.family_id
		AND round.child_id = NEW.child_id
		AND round.session_id = NEW.session_id
		AND round.round_number = NEW.round_number;
	IF expected_item_id IS NULL OR expected_item_id <> NEW.task_item_id::text THEN
		RAISE EXCEPTION 'DICTATION_ROUND_MEMBER_MISMATCH';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_round_member_validate_trigger
BEFORE INSERT OR UPDATE ON dictation_round_items
FOR EACH ROW EXECUTE FUNCTION validate_dictation_round_member();--> statement-breakpoint
CREATE FUNCTION protect_dictation_round_member_delete() RETURNS trigger AS $$
BEGIN
	IF pg_trigger_depth() = 1 AND EXISTS (
		SELECT 1
		FROM dictation_rounds round
		WHERE round.family_id = OLD.family_id
			AND round.child_id = OLD.child_id
			AND round.session_id = OLD.session_id
			AND round.round_number = OLD.round_number
	) THEN
		RAISE EXCEPTION 'DICTATION_ROUND_MEMBER_IMMUTABLE';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER dictation_round_member_delete_trigger
BEFORE DELETE ON dictation_round_items
FOR EACH ROW EXECUTE FUNCTION protect_dictation_round_member_delete();--> statement-breakpoint
CREATE FUNCTION validate_dictation_round_membership_complete() RETURNS trigger AS $$
DECLARE
	target_family_id uuid;
	target_child_id uuid;
	target_session_id uuid;
	target_round_number integer;
	expected_items jsonb;
	member_count integer;
BEGIN
	IF TG_OP = 'DELETE' THEN
		target_family_id := OLD.family_id;
		target_child_id := OLD.child_id;
		target_session_id := OLD.session_id;
		target_round_number := OLD.round_number;
	ELSE
		target_family_id := NEW.family_id;
		target_child_id := NEW.child_id;
		target_session_id := NEW.session_id;
		target_round_number := NEW.round_number;
	END IF;
	SELECT round.item_ids
	INTO expected_items
	FROM dictation_rounds round
	WHERE round.family_id = target_family_id
		AND round.child_id = target_child_id
		AND round.session_id = target_session_id
		AND round.round_number = target_round_number;
	IF expected_items IS NULL THEN
		RETURN NULL;
	END IF;
	SELECT count(*)::integer
	INTO member_count
	FROM dictation_round_items member
	WHERE member.family_id = target_family_id
		AND member.child_id = target_child_id
		AND member.session_id = target_session_id
		AND member.round_number = target_round_number;
	IF member_count <> jsonb_array_length(expected_items) OR EXISTS (
		SELECT 1
		FROM dictation_round_items member
		WHERE member.family_id = target_family_id
			AND member.child_id = target_child_id
			AND member.session_id = target_session_id
			AND member.round_number = target_round_number
			AND expected_items ->> member.position <> member.task_item_id::text
	) THEN
		RAISE EXCEPTION 'DICTATION_ROUND_MEMBERSHIP_INCOMPLETE';
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dictation_round_membership_complete_from_round
AFTER INSERT OR UPDATE ON dictation_rounds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_dictation_round_membership_complete();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dictation_round_membership_complete_from_member
AFTER INSERT OR UPDATE OR DELETE ON dictation_round_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_dictation_round_membership_complete();
