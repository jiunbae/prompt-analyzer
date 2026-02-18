-- Add composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_prompts_user_timestamp ON prompts (user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_prompts_device ON prompts (device_name);
CREATE INDEX IF NOT EXISTS idx_prompts_user_project ON prompts (user_id, project_name);

-- Add userId and id to analytics_daily for per-user caching
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY;
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS total_response_tokens INTEGER DEFAULT 0;
ALTER TABLE analytics_daily DROP CONSTRAINT IF EXISTS analytics_daily_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_user_date ON analytics_daily (user_id, date);
