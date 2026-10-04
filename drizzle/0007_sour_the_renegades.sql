CREATE TABLE "parent_mode_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parent_mode_unlocks" ADD CONSTRAINT "parent_mode_unlocks_family_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."devices"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_mode_unlocks" ADD CONSTRAINT "parent_mode_unlocks_family_guardian_fk" FOREIGN KEY ("family_id","guardian_id") REFERENCES "public"."guardians"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_mode_unlocks_token_hash_unique" ON "parent_mode_unlocks" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "parent_mode_unlocks_device_id_idx" ON "parent_mode_unlocks" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "parent_mode_unlocks_expires_at_idx" ON "parent_mode_unlocks" USING btree ("expires_at");