CREATE TABLE "agent_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"model" text,
	"system_prompt" text,
	"temperature" real,
	"max_tokens" integer,
	"max_iterations" integer,
	"is_active" boolean DEFAULT true,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "ai_service_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_type" text NOT NULL,
	"provider" text,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"model" text,
	"endpoint" text,
	"query_endpoint" text,
	"priority" integer DEFAULT 0,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"settings" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_service_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"service_type" text NOT NULL,
	"provider" text NOT NULL,
	"default_url" text,
	"preset_models" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"voice_id" text NOT NULL,
	"voice_name" text NOT NULL,
	"description" text,
	"language" text,
	"provider" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "ai_voices_voice_id_unique" UNIQUE("voice_id")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"drama_id" integer,
	"episode_id" integer,
	"storyboard_id" integer,
	"storyboard_num" integer,
	"name" text,
	"description" text,
	"type" text,
	"category" text,
	"url" text,
	"thumbnail_url" text,
	"local_path" text,
	"file_size" integer,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"duration" integer,
	"format" text,
	"image_gen_id" integer,
	"video_gen_id" integer,
	"is_favorite" boolean DEFAULT false,
	"view_count" integer DEFAULT 0,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"drama_id" integer NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"description" text,
	"appearance" text,
	"personality" text,
	"voice_style" text,
	"image_url" text,
	"reference_images" text,
	"seed_value" text,
	"sort_order" integer,
	"local_path" text,
	"voice_sample_url" text,
	"voice_provider" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dramas" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"genre" text,
	"style" text DEFAULT 'realistic',
	"total_episodes" integer DEFAULT 1,
	"total_duration" integer DEFAULT 0,
	"status" text DEFAULT 'draft' NOT NULL,
	"thumbnail" text,
	"tags" text,
	"metadata" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "episode_characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"scene_id" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"drama_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"script_content" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"status" text DEFAULT 'draft',
	"video_url" text,
	"thumbnail" text,
	"image_config_id" integer,
	"video_config_id" integer,
	"audio_config_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "image_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"storyboard_id" integer,
	"drama_id" integer,
	"scene_id" integer,
	"character_id" integer,
	"prop_id" integer,
	"image_type" text,
	"frame_type" text,
	"provider" text,
	"prompt" text,
	"negative_prompt" text,
	"model" text,
	"size" text,
	"quality" text,
	"style" text,
	"steps" integer,
	"cfg_scale" real,
	"seed" integer,
	"image_url" text,
	"minio_url" text,
	"local_path" text,
	"status" text DEFAULT 'pending',
	"task_id" text,
	"error_msg" text,
	"width" integer,
	"height" integer,
	"reference_images" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "props" (
	"id" serial PRIMARY KEY NOT NULL,
	"drama_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"description" text,
	"prompt" text,
	"image_url" text,
	"reference_images" text,
	"local_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"drama_id" integer NOT NULL,
	"episode_id" integer,
	"location" text NOT NULL,
	"time" text NOT NULL,
	"prompt" text NOT NULL,
	"storyboard_count" integer DEFAULT 1,
	"image_url" text,
	"status" text DEFAULT 'pending',
	"local_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "storyboard_characters" (
	"storyboard_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	CONSTRAINT "storyboard_characters_storyboard_id_character_id_pk" PRIMARY KEY("storyboard_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"scene_id" integer,
	"storyboard_number" integer NOT NULL,
	"title" text,
	"location" text,
	"time" text,
	"shot_type" text,
	"angle" text,
	"movement" text,
	"action" text,
	"result" text,
	"atmosphere" text,
	"image_prompt" text,
	"video_prompt" text,
	"bgm_prompt" text,
	"sound_effect" text,
	"dialogue" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"composed_image" text,
	"first_frame_image" text,
	"last_frame_image" text,
	"reference_images" text,
	"video_url" text,
	"tts_audio_url" text,
	"subtitle_url" text,
	"composed_video_url" text,
	"status" text DEFAULT 'pending',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "video_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"storyboard_id" integer,
	"drama_id" integer,
	"provider" text,
	"prompt" text,
	"model" text,
	"image_gen_id" integer,
	"reference_mode" text,
	"image_url" text,
	"first_frame_url" text,
	"last_frame_url" text,
	"reference_image_urls" text,
	"duration" integer,
	"fps" integer,
	"resolution" text,
	"aspect_ratio" text,
	"style" text,
	"motion_level" integer,
	"camera_motion" text,
	"seed" integer,
	"video_url" text,
	"minio_url" text,
	"local_path" text,
	"status" text DEFAULT 'pending',
	"task_id" text,
	"error_msg" text,
	"width" integer,
	"height" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "video_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer,
	"drama_id" integer,
	"title" text,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'pending',
	"scenes" text,
	"merged_url" text,
	"duration" integer,
	"task_id" text,
	"error_msg" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"deleted_at" text
);
