PRAGMA foreign_keys = ON;

ALTER TABLE jobs ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'unpublished';
ALTER TABLE jobs ADD COLUMN published_at TEXT;
ALTER TABLE jobs ADD COLUMN hidden_at TEXT;
ALTER TABLE jobs ADD COLUMN moderation_note TEXT;
ALTER TABLE jobs ADD COLUMN target_key TEXT;

UPDATE jobs
SET publication_status = 'published',
    published_at = COALESCE(finished_at, updated_at),
    target_key = lower(rtrim(target_url, '/'))
WHERE status = 'completed'
  AND report_id IS NOT NULL;

UPDATE jobs
SET target_key = lower(rtrim(target_url, '/'))
WHERE target_key IS NULL;

CREATE INDEX IF NOT EXISTS jobs_publication_published_idx
ON jobs(publication_status, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_target_publication_idx
ON jobs(target_key, publication_status, published_at DESC);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '6', datetime('now'));
