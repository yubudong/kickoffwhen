ALTER TABLE "children" ADD COLUMN "textbook_edition_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "display_name" text DEFAULT '家长' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_one_owner_per_family_unique" ON "guardians" USING btree ("family_id") WHERE "guardians"."is_owner" = true;