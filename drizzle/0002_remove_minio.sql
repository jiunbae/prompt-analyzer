-- Remove MinIO dependency: rename minio_key to event_key, drop MinIO-specific tables

-- Rename minio_key column to event_key
ALTER TABLE "prompts" RENAME COLUMN "minio_key" TO "event_key";

-- Drop and recreate index with new name
DROP INDEX IF EXISTS "idx_prompts_minio_key";
CREATE INDEX "idx_prompts_event_key" ON "prompts" USING btree ("event_key");

-- Drop MinIO sync log table
DROP TABLE IF EXISTS "minio_sync_log";

-- Drop sync settings table
DROP TABLE IF EXISTS "sync_settings";
