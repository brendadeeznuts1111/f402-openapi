CREATE TABLE IF NOT EXISTS agent_position_data (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  sport_id INTEGER,
  sport_name TEXT,
  total_wagered INTEGER,
  total_to_win INTEGER,
  wager_count INTEGER,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES api_snapshots(id),
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_position_data_captured
  ON agent_position_data(captured_at);

CREATE INDEX IF NOT EXISTS idx_position_data_agent_captured
  ON agent_position_data(sport_id, captured_at);
