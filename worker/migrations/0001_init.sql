CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT,
  name            TEXT,
  public_to_group INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_sha256 TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX idx_devices_user ON devices(user_id);

CREATE TABLE sessions (
  user_id               TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  source                TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL,
  output_tokens         INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_read_tokens     INTEGER NOT NULL,
  total_tokens          INTEGER NOT NULL,
  total_cost            REAL    NOT NULL,
  credits               REAL,
  first_activity        TEXT,
  last_activity         TEXT,
  models_used           TEXT,
  model_breakdowns      TEXT,
  project_path          TEXT,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, session_id)
);
CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity);
