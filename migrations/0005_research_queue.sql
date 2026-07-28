PRAGMA foreign_keys = ON;

ALTER TABLE jobs ADD COLUMN capability_hash TEXT;
ALTER TABLE jobs ADD COLUMN queued_at TEXT;
ALTER TABLE jobs ADD COLUMN started_at TEXT;
ALTER TABLE jobs ADD COLUMN finished_at TEXT;
ALTER TABLE jobs ADD COLUMN auto_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_auto_retry_at TEXT;

UPDATE jobs
SET queued_at = created_at
WHERE queued_at IS NULL;

UPDATE jobs
SET started_at = created_at
WHERE started_at IS NULL
  AND status IN ('running', 'completed', 'failed');

UPDATE jobs
SET finished_at = updated_at
WHERE finished_at IS NULL
  AND status IN ('completed', 'failed');

CREATE INDEX IF NOT EXISTS jobs_status_queued_idx
ON jobs(status, queued_at);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '5', datetime('now'));
