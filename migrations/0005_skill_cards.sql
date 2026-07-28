PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skill_cards (
  id TEXT PRIMARY KEY,
  actor_hash TEXT NOT NULL,
  job_id TEXT NOT NULL,
  report_id TEXT,
  target_key TEXT NOT NULL,
  target_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  occupation_code TEXT NOT NULL,
  occupation_title TEXT NOT NULL,
  game_profile_json TEXT NOT NULL,
  share_slug TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (actor_hash, target_key, occupation_code)
);

CREATE INDEX IF NOT EXISTS skill_cards_actor_updated_idx
ON skill_cards(actor_hash, updated_at);

CREATE INDEX IF NOT EXISTS skill_cards_expiry_idx
ON skill_cards(expires_at);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '5', datetime('now'));
