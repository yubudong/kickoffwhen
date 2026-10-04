CREATE TABLE "textbook_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"section_order" integer NOT NULL,
	"title" text NOT NULL,
	"section_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "textbook_sections_unit_key_unique" UNIQUE("unit_id","section_key"),
	CONSTRAINT "textbook_sections_unit_order_unique" UNIQUE("unit_id","section_order"),
	CONSTRAINT "textbook_sections_type_check" CHECK ("textbook_sections"."section_type" in ('lesson', 'language_garden', 'other'))
);
--> statement-breakpoint
ALTER TABLE "learning_cards" ADD COLUMN "pinyin_text" text;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD COLUMN "curriculum_source" text;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD COLUMN "source_order" integer;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "textbook_sections" ADD CONSTRAINT "textbook_sections_unit_id_textbook_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."textbook_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_section_id_textbook_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."textbook_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_cards_section_id_idx" ON "learning_cards" USING btree ("section_id");--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_curriculum_source_check" CHECK ("learning_cards"."curriculum_source" is null or "learning_cards"."curriculum_source" in ('required_vocabulary', 'writing_practice'));