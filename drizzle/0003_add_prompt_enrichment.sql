ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS topic_tags TEXT[];
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_prompts_quality ON prompts (quality_score);
CREATE INDEX IF NOT EXISTS idx_prompts_enriched ON prompts (enriched_at);
