PRAGMA foreign_keys = ON;

ALTER TABLE jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_retry_at TEXT;

CREATE TABLE IF NOT EXISTS provider_calls (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT,
  http_status INTEGER,
  finish_reason TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_microusd INTEGER,
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_calls_job_created_idx
ON provider_calls(job_id, created_at);

UPDATE jobs
SET error_code = 'provider_schema_invalid'
WHERE status = 'failed'
  AND error_code = 'research_failed'
  AND (
    error_message LIKE '%Unterminated string in JSON%'
    OR error_message LIKE '%Unexpected end of JSON%'
    OR error_message LIKE '%JSON at position%'
  );

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '4', datetime('now'));
