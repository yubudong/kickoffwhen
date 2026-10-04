ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_subject_check" CHECK ("learning_cards"."subject" in ('chinese', 'english'));--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_source_check" CHECK ("learning_cards"."source" in ('manual', 'bulk', 'ocr', 'builtin'));--> statement-breakpoint
ALTER TABLE "learning_cards" ADD CONSTRAINT "learning_cards_builtin_scope_check" CHECK ((
        ("learning_cards"."source" = 'builtin' and "learning_cards"."family_id" is null and "learning_cards"."builtin_key" is not null)
        or
        ("learning_cards"."source" <> 'builtin' and "learning_cards"."family_id" is not null and "learning_cards"."builtin_key" is null)
      ));--> statement-breakpoint
ALTER TABLE "ocr_draft_lines" ADD CONSTRAINT "ocr_draft_lines_status_check" CHECK ("ocr_draft_lines"."status" in ('draft', 'confirmed', 'rejected'));--> statement-breakpoint
ALTER TABLE "ocr_drafts" ADD CONSTRAINT "ocr_drafts_subject_check" CHECK ("ocr_drafts"."subject" in ('chinese', 'english'));--> statement-breakpoint
ALTER TABLE "textbook_editions" ADD CONSTRAINT "textbook_editions_subject_check" CHECK ("textbook_editions"."subject" in ('chinese', 'english'));