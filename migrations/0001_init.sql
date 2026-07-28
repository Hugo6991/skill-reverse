PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  actor_hash TEXT NOT NULL,
  target_url TEXT NOT NULL,
  support_urls_json TEXT NOT NULL DEFAULT '[]',
  occupation_code TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'validate',
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  reserved_cents INTEGER NOT NULL DEFAULT 50,
  actual_cents INTEGER NOT NULL DEFAULT 0,
  workflow_id TEXT,
  report_id TEXT,
  degraded_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_actor_created_idx ON jobs(actor_hash, created_at);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  capability_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  author TEXT,
  retrieved_at TEXT NOT NULL,
  r2_key TEXT,
  excerpt TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_artifacts_job_idx ON source_artifacts(job_id);

CREATE TABLE IF NOT EXISTS occupations (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'O*NET',
  version TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  competencies_json TEXT NOT NULL DEFAULT '[]'
);

CREATE VIRTUAL TABLE IF NOT EXISTS occupations_fts USING fts5(
  code,
  title,
  description,
  aliases,
  content=''
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '1', datetime('now'));
