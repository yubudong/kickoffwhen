ALTER TABLE "companions" DROP CONSTRAINT "companion_rules";--> statement-breakpoint
ALTER TABLE "companion_memories" ADD COLUMN "origin" text DEFAULT 'growth' NOT NULL;--> statement-breakpoint
ALTER TABLE "companions" ADD COLUMN "display_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Preserve unlocked age semantics without changing growth wallets or reward history.
-- Old egg/young/growing/final stages become egg/young/teen/adult: 0,2,3,4.
UPDATE "companions" SET
  "display_stage" = CASE "stage" WHEN 1 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 ELSE 0 END,
  "stage" = CASE "stage" WHEN 1 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 ELSE 0 END,
  "appearance" = CASE WHEN "appearance"='human' AND "species" IN ('fox','phoenix','cat','wolf') AND "stage">=2 THEN 'human' ELSE 'animal' END;--> statement-breakpoint
-- Two passes avoid immediate unique(child_id,stage) collisions while shifting 1,2,3.
UPDATE "companion_memories" SET "stage"="stage"+10;--> statement-breakpoint
UPDATE "companion_memories" SET "stage"=CASE "stage" WHEN 11 THEN 2 WHEN 12 THEN 3 WHEN 13 THEN 4 ELSE "stage" END;--> statement-breakpoint
-- New lower-age appearances are unlocked for existing companions, clearly marked as upgrade gifts.
INSERT INTO "companion_memories" ("family_id","child_id","stage","species","origin","created_at")
SELECT c."family_id",c."child_id",s.stage,c."species",'upgrade',
  COALESCE((SELECT min(m."created_at") FROM "companion_memories" m WHERE m."child_id"=c."child_id"),now())
FROM "companions" c CROSS JOIN LATERAL generate_series(1,c."stage") AS s(stage)
ON CONFLICT ("child_id","stage") DO NOTHING;--> statement-breakpoint
ALTER TABLE "companion_memories" ADD CONSTRAINT "companion_memory_rules" CHECK ("companion_memories"."stage" between 1 and 4 and "companion_memories"."origin" in ('growth','upgrade'));--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companion_rules" CHECK ("companions"."species" in ('dragon','fox','phoenix','capybara','rabbit','cat','wolf','unicorn') and "companions"."stage" between 0 and 4 and (("companions"."stage"=0 and "companions"."display_stage"=0) or ("companions"."stage">0 and "companions"."display_stage" between 1 and "companions"."stage")) and "companions"."appearance" in ('animal','human') and "companions"."human_style" in ('boy','girl') and ("companions"."appearance"='animal' or ("companions"."species" in ('fox','phoenix','cat','wolf') and "companions"."display_stage">=3)));