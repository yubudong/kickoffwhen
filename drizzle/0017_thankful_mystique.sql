ALTER TABLE "learning_task_items" ADD CONSTRAINT "learning_task_items_scope_task_item_unique" UNIQUE("family_id","child_id","task_id","id");--> statement-breakpoint
ALTER TABLE "dictation_rounds" ADD CONSTRAINT "dictation_rounds_full_scope_number_unique" UNIQUE("family_id","child_id","session_id","round_number");--> statement-breakpoint
ALTER TABLE "dictation_sessions" ADD CONSTRAINT "dictation_sessions_scope_id_task_unique" UNIQUE("family_id","child_id","id","task_id");--> statement-breakpoint
CREATE TABLE "dictation_round_items" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"task_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "dictation_round_items_pk" PRIMARY KEY("family_id","child_id","session_id","round_number","task_item_id"),
	CONSTRAINT "dictation_round_items_session_round_position_unique" UNIQUE("session_id","round_number","position"),
	CONSTRAINT "dictation_round_items_round_check" CHECK ("dictation_round_items"."round_number" >= 1),
	CONSTRAINT "dictation_round_items_position_check" CHECK ("dictation_round_items"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dictation_round_items" ADD CONSTRAINT "dictation_round_items_round_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number") REFERENCES "public"."dictation_rounds"("family_id","child_id","session_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_round_items" ADD CONSTRAINT "dictation_round_items_session_item_scope_fk" FOREIGN KEY ("family_id","child_id","session_id","task_item_id") REFERENCES "public"."dictation_session_items"("family_id","child_id","session_id","task_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "dictation_round_items" (
	"family_id", "child_id", "session_id", "round_number", "task_item_id", "position"
)
SELECT
	round."family_id",
	round."child_id",
	round."session_id",
	round."round_number",
	item."value"::uuid,
	(item."ordinality" - 1)::integer
FROM "dictation_rounds" round
CROSS JOIN LATERAL jsonb_array_elements_text(round."item_ids") WITH ORDINALITY AS item("value", "ordinality");--> statement-breakpoint
ALTER TABLE "dictation_answer_events" ADD CONSTRAINT "dictation_answer_round_item_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number","task_item_id") REFERENCES "public"."dictation_round_items"("family_id","child_id","session_id","round_number","task_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_completion_events" ADD CONSTRAINT "dictation_completion_session_task_fk" FOREIGN KEY ("family_id","child_id","session_id","task_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_playback_events" ADD CONSTRAINT "dictation_playback_round_item_fk" FOREIGN KEY ("family_id","child_id","session_id","round_number","task_item_id") REFERENCES "public"."dictation_round_items"("family_id","child_id","session_id","round_number","task_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_session_task_fk" FOREIGN KEY ("family_id","child_id","session_id","task_id") REFERENCES "public"."dictation_sessions"("family_id","child_id","id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictation_session_items" ADD CONSTRAINT "dictation_session_items_task_item_scope_fk" FOREIGN KEY ("family_id","child_id","task_id","task_item_id") REFERENCES "public"."learning_task_items"("family_id","child_id","task_id","id") ON DELETE restrict ON UPDATE no action;
