-- Add composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_prompts_user_timestamp ON prompts (user_id, timestamp);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompts_user_project ON prompts (user_id, project_name);
--> statement-breakpoint

-- Safely migrate analytics_daily PK from date to uuid id column, add user_id
-- Step 1: Drop the existing primary key on date
ALTER TABLE analytics_daily DROP CONSTRAINT IF EXISTS analytics_daily_pkey;
--> statement-breakpoint

-- Step 2: Add columns if not present
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS user_id UUID;
--> statement-breakpoint
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS total_response_tokens INTEGER DEFAULT 0;
--> statement-breakpoint

-- Step 3: Backfill id for any existing rows that lack one
UPDATE analytics_daily SET id = gen_random_uuid() WHERE id IS NULL;
--> statement-breakpoint

-- Step 4: Add primary key on id
ALTER TABLE analytics_daily ADD PRIMARY KEY (id);
--> statement-breakpoint

-- Step 5: Assign existing analytics rows to users based on prompt data.
-- For each (date) row without a user_id, find the user who has the most prompts
-- on that date and assign the row to them. This preserves legacy data.
UPDATE analytics_daily ad
SET user_id = sub.user_id
FROM (
  SELECT DISTINCT ON (date(p.timestamp))
    date(p.timestamp) AS prompt_date,
    p.user_id
  FROM prompts p
  WHERE p.user_id IS NOT NULL
  GROUP BY date(p.timestamp), p.user_id
  ORDER BY date(p.timestamp), count(*) DESC
) sub
WHERE ad.user_id IS NULL
  AND ad.date = sub.prompt_date;
--> statement-breakpoint

-- Delete any remaining rows that could not be assigned (no matching prompt data)
DELETE FROM analytics_daily WHERE user_id IS NULL;
--> statement-breakpoint

ALTER TABLE analytics_daily ALTER COLUMN user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE analytics_daily ADD CONSTRAINT fk_analytics_daily_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint

-- Step 6: Unique composite index for upsert conflict target
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_user_date ON analytics_daily (user_id, date);
