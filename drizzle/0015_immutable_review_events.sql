CREATE FUNCTION reject_review_event_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'REVIEW_EVENT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER review_events_immutable_trigger
BEFORE UPDATE ON review_events
FOR EACH ROW EXECUTE FUNCTION reject_review_event_update();
