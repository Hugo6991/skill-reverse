PRAGMA foreign_keys = ON;

ALTER TABLE jobs ADD COLUMN source_window_closes_at TEXT;
ALTER TABLE jobs ADD COLUMN sources_finalized_at TEXT;

CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS job_sources_job_created_idx
ON job_sources(job_id, created_at);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '3', datetime('now'));
