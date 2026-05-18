CREATE TABLE IF NOT EXISTS graded_wagers (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  wager_number INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  login TEXT NOT NULL,
  wager_type TEXT NOT NULL,
  amount_wagered INTEGER NOT NULL,
  to_win_amount INTEGER,
  grade_date_time TEXT,
  result TEXT,
  net_amount INTEGER,
  insert_date_time TEXT,
  ticket_writer TEXT,
  volume_amount INTEGER,
  short_desc TEXT,
  agent_login TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES api_snapshots(id),
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_graded_wagers_captured
  ON graded_wagers(captured_at);

CREATE INDEX IF NOT EXISTS idx_graded_wagers_agent_captured
  ON graded_wagers(agent_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_graded_wagers_wager_number
  ON graded_wagers(wager_number);
