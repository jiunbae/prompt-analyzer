CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  secret VARCHAR(255),
  events TEXT[] NOT NULL DEFAULT ARRAY['prompt.created'],
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  last_status INTEGER,
  fail_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks (user_id);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event VARCHAR(100) NOT NULL,
  payload JSONB,
  status_code INTEGER,
  response_body TEXT,
  duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
