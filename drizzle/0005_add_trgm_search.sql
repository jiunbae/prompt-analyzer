-- Enable pg_trgm extension for trigram-based similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN trigram index on prompt_text for fast similarity queries
CREATE INDEX IF NOT EXISTS idx_prompts_prompt_text_trgm ON prompts USING gin (prompt_text gin_trgm_ops);
