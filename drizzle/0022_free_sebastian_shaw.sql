ALTER TABLE "learning_task_items" DROP CONSTRAINT "learning_task_items_kind_check";--> statement-breakpoint
ALTER TABLE "dictation_session_items" DROP CONSTRAINT "dictation_session_items_kind_check";--> statement-breakpoint
ALTER TABLE "review_events" DROP CONSTRAINT "review_events_type_check";--> statement-breakpoint
ALTER TABLE "learning_task_items" ADD CONSTRAINT "learning_task_items_kind_check" CHECK ("learning_task_items"."kind" in ('due_review', 'new', 'manual_review'));--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_kind_check" CHECK ("dictation_session_items"."kind" in ('due_review', 'new', 'manual_review'));--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_type_check" CHECK ("review_events"."event_type" in ('new_first', 'scheduled_first', 'manual_first', 'same_session_relearning'));