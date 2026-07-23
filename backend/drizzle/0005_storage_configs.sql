CREATE TABLE IF NOT EXISTS "storage_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'local' NOT NULL,
	"name" text NOT NULL,
	"bucket" text DEFAULT '',
	"endpoint" text DEFAULT '',
	"access_key_id" text DEFAULT '',
	"access_key_secret" text DEFAULT '',
	"domain" text DEFAULT '',
	"prefix" text DEFAULT '',
	"is_active" boolean DEFAULT false,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
