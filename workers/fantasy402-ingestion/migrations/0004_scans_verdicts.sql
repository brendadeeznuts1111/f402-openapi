CREATE TABLE IF NOT EXISTS scans_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT UNIQUE NOT NULL,
  timestamp TEXT NOT NULL,
  url TEXT NOT NULL,
  malicious INTEGER NOT NULL DEFAULT 0,
  tls_valid_days INTEGER,
  agent_readiness_level INTEGER,
  scan_r2_key TEXT,
  screenshot_r2_key TEXT,
  har_r2_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scans_timestamp
  ON scans_verdicts(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_scans_malicious_timestamp
  ON scans_verdicts(malicious, timestamp DESC);
