-- Add composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_prompts_user_timestamp ON prompts (user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_prompts_user_project ON prompts (user_id, project_name);

-- Safely migrate analytics_daily PK from date to uuid id column, add user_id
-- Step 1: Drop the existing primary key on date
ALTER TABLE analytics_daily DROP CONSTRAINT IF EXISTS analytics_daily_pkey;

-- Step 2: Add columns if not present
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS total_response_tokens INTEGER DEFAULT 0;

-- Step 3: Backfill id for any existing rows that lack one
UPDATE analytics_daily SET id = gen_random_uuid() WHERE id IS NULL;

-- Step 4: Add primary key on id
ALTER TABLE analytics_daily ADD PRIMARY KEY (id);

-- Step 5: Make user_id NOT NULL (backfill nulls first — set to first user or fail gracefully)
-- In practice, existing rows predate per-user; delete stale global rows before enforcing
DELETE FROM analytics_daily WHERE user_id IS NULL;
ALTER TABLE analytics_daily ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE analytics_daily ADD CONSTRAINT fk_analytics_daily_user FOREIGN KEY (user_id) REFERENCES users(id);

-- Step 6: Unique composite index for upsert conflict target
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_user_date ON analytics_daily (user_id, date);
