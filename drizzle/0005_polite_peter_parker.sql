CREATE TABLE "child_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_child_access" (
	"device_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_child_access_device_id_child_id_pk" PRIMARY KEY("device_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_family_id_id_unique" UNIQUE("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"child_ids" uuid[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_family_id_id_unique" UNIQUE("family_id","id");--> statement-breakpoint
ALTER TABLE "child_sessions" ADD CONSTRAINT "child_sessions_family_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."devices"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_sessions" ADD CONSTRAINT "child_sessions_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_child_access" ADD CONSTRAINT "device_child_access_family_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."devices"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_child_access" ADD CONSTRAINT "device_child_access_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "child_sessions_token_hash_unique" ON "child_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "child_sessions_device_id_idx" ON "child_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "child_sessions_child_id_idx" ON "child_sessions" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "device_child_access_family_id_idx" ON "device_child_access" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "device_child_access_child_id_idx" ON "device_child_access" USING btree ("child_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_unique" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "devices_family_id_idx" ON "devices" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_codes_code_hash_unique" ON "pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "pairing_codes_family_id_idx" ON "pairing_codes" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "pairing_codes_claimable_idx" ON "pairing_codes" USING btree ("expires_at") WHERE "pairing_codes"."claimed_at" is null;
