CREATE TABLE IF NOT EXISTS web_logs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  login TEXT NOT NULL,
  operation TEXT,
  data TEXT,
  ip_address TEXT,
  access_date_time TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES api_snapshots(id),
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_web_logs_login
  ON web_logs(login);

CREATE INDEX IF NOT EXISTS idx_web_logs_access_time
  ON web_logs(access_date_time);

CREATE INDEX IF NOT EXISTS idx_web_logs_login_access_time
  ON web_logs(login, access_date_time);
