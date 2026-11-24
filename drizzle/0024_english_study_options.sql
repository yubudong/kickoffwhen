ALTER TABLE "learning_tasks" ADD COLUMN "english_study_options" jsonb;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_english_study_check" CHECK ("learning_tasks"."english_study_options" is null or (
      jsonb_typeof("learning_tasks"."english_study_options") = 'object'
      and "learning_tasks"."english_study_options" ? 'version' and jsonb_typeof("learning_tasks"."english_study_options"->'version') = 'number' and "learning_tasks"."english_study_options"->>'version' = '1'
      and "learning_tasks"."english_study_options" ? 'mode' and "learning_tasks"."english_study_options"->>'mode' in ('standard','assisted')
      and "learning_tasks"."english_study_options" ? 'includeRecognition' and jsonb_typeof("learning_tasks"."english_study_options"->'includeRecognition') = 'boolean'));