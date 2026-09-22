CREATE TABLE "private_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"relative_path" text NOT NULL,
	"dedupe_key" text,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_media_kind_check" CHECK ("private_media"."kind" in ('tts_audio', 'ocr_source', 'habit_photo')),
	CONSTRAINT "private_media_mime_type_check" CHECK ("private_media"."mime_type" in ('audio/mpeg', 'image/jpeg', 'image/png')),
	CONSTRAINT "private_media_kind_mime_check" CHECK ((
        ("private_media"."kind" = 'tts_audio' and "private_media"."mime_type" = 'audio/mpeg')
        or
        ("private_media"."kind" in ('ocr_source', 'habit_photo') and "private_media"."mime_type" in ('image/jpeg', 'image/png'))
      )),
	CONSTRAINT "private_media_tts_child_check" CHECK ("private_media"."kind" <> 'tts_audio' or "private_media"."child_id" is not null),
	CONSTRAINT "private_media_byte_size_check" CHECK ("private_media"."byte_size" > 0 and "private_media"."byte_size" <= 10485760),
	CONSTRAINT "private_media_sha256_check" CHECK ("private_media"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
UPDATE "jobs" SET "dedupe_key" = 'legacy:' || "id"::text WHERE "dedupe_key" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "dedupe_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "private_media" ADD CONSTRAINT "private_media_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_media" ADD CONSTRAINT "private_media_family_child_fk" FOREIGN KEY ("family_id","child_id") REFERENCES "public"."children"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "private_media_relative_path_unique" ON "private_media" USING btree ("relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "private_media_dedupe_key_unique" ON "private_media" USING btree ("dedupe_key") WHERE "private_media"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "private_media_family_id_idx" ON "private_media" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "private_media_family_child_idx" ON "private_media" USING btree ("family_id","child_id");--> statement-breakpoint
CREATE INDEX "private_media_expires_at_idx" ON "private_media" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_tts', 'run_ocr', 'delete_media', 'build_weekly_report'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0 and "jobs"."attempts" <= 5);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_last_error_safe_check" CHECK ("jobs"."last_error" is null or length("jobs"."last_error") <= 128);
