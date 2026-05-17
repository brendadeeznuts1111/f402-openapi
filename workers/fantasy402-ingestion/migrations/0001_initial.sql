CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  endpoints_requested TEXT NOT NULL,
  endpoints_succeeded INTEGER NOT NULL DEFAULT 0,
  endpoints_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS api_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  path TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  item_count INTEGER,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE TABLE IF NOT EXISTS agent_performance (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  total_wagers INTEGER NOT NULL DEFAULT 0,
  total_volume REAL NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0,
  raw_snapshot_id TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id),
  FOREIGN KEY (raw_snapshot_id) REFERENCES api_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_api_snapshots_endpoint_captured
  ON api_snapshots(endpoint_key, captured_at);

CREATE INDEX IF NOT EXISTS idx_agent_performance_agent_captured
  ON agent_performance(agent_id, captured_at);
