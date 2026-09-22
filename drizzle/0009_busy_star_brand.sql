DROP INDEX "pairing_rate_limits_updated_at_idx";--> statement-breakpoint
CREATE INDEX "pairing_rate_limits_window_started_at_idx" ON "pairing_rate_limits" USING btree ("window_started_at");