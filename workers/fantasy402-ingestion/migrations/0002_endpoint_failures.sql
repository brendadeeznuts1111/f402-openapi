CREATE TABLE IF NOT EXISTS endpoint_failures (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  path TEXT NOT NULL,
  failed_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  error_message TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_endpoint_failures_run_endpoint
  ON endpoint_failures(run_id, endpoint_key);

CREATE INDEX IF NOT EXISTS idx_endpoint_failures_failed_at
  ON endpoint_failures(failed_at);
