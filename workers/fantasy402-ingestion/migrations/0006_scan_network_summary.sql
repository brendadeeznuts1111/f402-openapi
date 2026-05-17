CREATE TABLE IF NOT EXISTS scan_network_summary (
  scan_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_requests INTEGER NOT NULL DEFAULT 0,
  status_counts_json TEXT NOT NULL,
  method_counts_json TEXT NOT NULL,
  host_counts_json TEXT NOT NULL,
  mime_counts_json TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_requests_json TEXT NOT NULL,
  slowest_requests_json TEXT NOT NULL,
  largest_responses_json TEXT NOT NULL,
  har_r2_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_network_summary_updated
  ON scan_network_summary(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_network_summary_failed
  ON scan_network_summary(failed_count, updated_at DESC);
