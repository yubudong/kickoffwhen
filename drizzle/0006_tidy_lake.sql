CREATE TABLE "pairing_code_child_access" (
	"pairing_code_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_code_child_access_pairing_code_id_child_id_pk" PRIMARY KEY("pairing_code_id","child_id")
);
--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_family_id_id_unique" UNIQUE("family_id","id");--> statement-breakpoint
ALTER TABLE "pairing_code_child_access" ADD CONSTRAINT "pairing_code_child_access_family_pairing_code_fk" FOREIGN KEY ("family_id","pairing_code_id") REFERENCES "public"."pairing_codes"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_code_child_access" ADD CONSTRAINT "pairing_code_child_access_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "pairing_code_child_access" ("pairing_code_id", "family_id", "child_id", "created_at")
SELECT DISTINCT "pairing_codes"."id", "pairing_codes"."family_id", "requested_children"."child_id", "pairing_codes"."created_at"
FROM "pairing_codes"
CROSS JOIN LATERAL unnest("pairing_codes"."child_ids") AS "requested_children"("child_id")
WHERE NOT EXISTS (
	SELECT 1
	FROM unnest("pairing_codes"."child_ids") AS "candidate_children"("child_id")
	LEFT JOIN "children"
		ON "children"."family_id" = "pairing_codes"."family_id"
		AND "children"."id" = "candidate_children"."child_id"
	WHERE "children"."id" IS NULL
)
AND cardinality("pairing_codes"."child_ids") = (
	SELECT count(DISTINCT "candidate_children"."child_id")
	FROM unnest("pairing_codes"."child_ids") AS "candidate_children"("child_id")
);--> statement-breakpoint
CREATE INDEX "pairing_code_child_access_family_id_idx" ON "pairing_code_child_access" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "pairing_code_child_access_child_id_idx" ON "pairing_code_child_access" USING btree ("child_id");--> statement-breakpoint
ALTER TABLE "device_child_access" ADD CONSTRAINT "device_child_access_family_device_child_unique" UNIQUE("family_id","device_id","child_id");--> statement-breakpoint
DELETE FROM "child_sessions"
WHERE NOT EXISTS (
	SELECT 1
	FROM "device_child_access"
	WHERE "device_child_access"."family_id" = "child_sessions"."family_id"
		AND "device_child_access"."device_id" = "child_sessions"."device_id"
		AND "device_child_access"."child_id" = "child_sessions"."child_id"
);--> statement-breakpoint
ALTER TABLE "child_sessions" ADD CONSTRAINT "child_sessions_family_device_child_access_fk" FOREIGN KEY ("family_id","device_id","child_id") REFERENCES "public"."device_child_access"("family_id","device_id","child_id") ON DELETE cascade ON UPDATE no action;
