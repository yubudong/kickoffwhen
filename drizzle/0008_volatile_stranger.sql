CREATE TABLE "pairing_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"attempt_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_child_access" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_child_access" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pairing_rate_limits_updated_at_idx" ON "pairing_rate_limits" USING btree ("updated_at");