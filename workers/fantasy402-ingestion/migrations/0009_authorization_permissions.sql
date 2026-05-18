CREATE TABLE IF NOT EXISTS authorization_permissions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  master_agent_id TEXT,
  commission_type TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES api_snapshots(id),
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_permissions_agent_captured
  ON authorization_permissions(agent_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_auth_permissions_snapshot
  ON authorization_permissions(snapshot_id);
