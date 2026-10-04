CREATE TABLE "learning_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid,
	"subject" text NOT NULL,
	"answer_text" text NOT NULL,
	"broadcast_text" text NOT NULL,
	"hint_text" text,
	"textbook_edition_id" uuid,
	"unit_id" uuid,
	"source" text NOT NULL,
	"builtin_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_draft_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"source_text" text NOT NULL,
	"source_order" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_card_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ocr_draft_lines_draft_id_order_unique" UNIQUE("draft_id","source_order")
);
--> statement-breakpoint
CREATE TABLE "ocr_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ocr_drafts_family_id_id_unique" UNIQUE("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "textbook_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher" text NOT NULL,
	"series" text NOT NULL,
	"subject" text NOT NULL,
	"grade" integer NOT NULL,
	"volume" text NOT NULL,
	"edition_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"textbook_edition_id" uuid NOT NULL,
	"unit_order" integer NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "textbook_units_edition_id_order_unique" UNIQUE("textbook_edition_id","unit_order")
);
--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_textbook_edition_id_textbook_editions_id_fk" FOREIGN KEY ("textbook_edition_id") REFERENCES "public"."textbook_editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_unit_id_textbook_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."textbook_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_draft_lines" ADD CONSTRAINT "ocr_draft_lines_confirmed_card_id_learning_cards_id_fk" FOREIGN KEY ("confirmed_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_draft_lines" ADD CONSTRAINT "ocr_draft_lines_family_draft_fk" FOREIGN KEY ("family_id","draft_id") REFERENCES "public"."ocr_drafts"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_drafts" ADD CONSTRAINT "ocr_drafts_family_guardian_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_units" ADD CONSTRAINT "textbook_units_textbook_edition_id_textbook_editions_id_fk" FOREIGN KEY ("textbook_edition_id") REFERENCES "public"."textbook_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_cards_builtin_key_unique" ON "learning_cards" USING btree ("builtin_key") WHERE "learning_cards"."builtin_key" is not null;--> statement-breakpoint
CREATE INDEX "learning_cards_family_id_idx" ON "learning_cards" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "learning_cards_family_subject_idx" ON "learning_cards" USING btree ("family_id","subject");--> statement-breakpoint
CREATE INDEX "learning_cards_unit_id_idx" ON "learning_cards" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "ocr_draft_lines_family_id_idx" ON "ocr_draft_lines" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "ocr_draft_lines_draft_id_idx" ON "ocr_draft_lines" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "ocr_draft_lines_status_idx" ON "ocr_draft_lines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ocr_drafts_family_id_idx" ON "ocr_drafts" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_editions_edition_unique" ON "textbook_editions" USING btree ("publisher","series","subject","grade","volume","edition_text");