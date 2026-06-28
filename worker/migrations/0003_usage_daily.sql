CREATE TABLE usage_daily (
  user_id      TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  source       TEXT NOT NULL,
  day          TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  total_cost   REAL NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, day)
);
CREATE INDEX idx_usage_daily_user_day ON usage_daily(user_id, day);
