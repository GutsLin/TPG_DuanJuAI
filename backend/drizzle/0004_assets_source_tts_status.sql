ALTER TABLE "assets" ADD COLUMN "source" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "storyboards" ADD COLUMN "tts_status" text;
