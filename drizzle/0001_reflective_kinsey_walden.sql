ALTER TABLE "guardians" ADD CONSTRAINT "guardians_family_id_id_unique" UNIQUE("family_id","id");--> statement-breakpoint
ALTER TABLE "parent_pins" ADD COLUMN "family_id" uuid;--> statement-breakpoint
UPDATE "parent_pins" AS "parent_pins"
SET "family_id" = "guardians"."family_id"
FROM "guardians" AS "guardians"
WHERE "parent_pins"."guardian_id" = "guardians"."id";--> statement-breakpoint
ALTER TABLE "parent_pins" ALTER COLUMN "family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_pins" ADD CONSTRAINT "parent_pins_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_pins" ADD CONSTRAINT "parent_pins_family_id_guardian_id_guardians_family_id_id_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE cascade ON UPDATE no action;
