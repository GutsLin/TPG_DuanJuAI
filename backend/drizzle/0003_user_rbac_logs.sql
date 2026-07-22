CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text DEFAULT 'creator' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_login_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "deleted_at" text,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "project_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "drama_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "role" text DEFAULT 'viewer' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "operation_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "drama_id" integer,
  "action" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "detail" text,
  "ip" text,
  "user_agent" text,
  "created_at" text NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_project_members_user_id" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_project_members_drama_id" ON "project_members" USING btree ("drama_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_members_drama_user" ON "project_members" USING btree ("drama_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_user_id" ON "operation_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_drama_id" ON "operation_logs" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_created_at" ON "operation_logs" USING btree ("created_at");
