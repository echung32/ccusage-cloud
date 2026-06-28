CREATE TABLE enroll_codes (
  code_sha256 TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX idx_enroll_codes_user ON enroll_codes(user_id);
