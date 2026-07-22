ALTER TABLE "image_generations" ADD COLUMN "config_id" integer;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "config_id" integer;--> statement-breakpoint
CREATE INDEX "idx_episodes_drama_id" ON "episodes" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_image_generations_status" ON "image_generations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_image_generations_storyboard_id" ON "image_generations" USING btree ("storyboard_id");--> statement-breakpoint
CREATE INDEX "idx_storyboards_episode_id" ON "storyboards" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "idx_storyboards_status" ON "storyboards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_video_generations_status" ON "video_generations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_video_generations_storyboard_id" ON "video_generations" USING btree ("storyboard_id");--> statement-breakpoint
CREATE INDEX "idx_video_merges_episode_id" ON "video_merges" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "idx_video_merges_status" ON "video_merges" USING btree ("status");