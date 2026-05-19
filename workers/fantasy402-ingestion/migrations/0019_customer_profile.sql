CREATE TABLE IF NOT EXISTS customer_accounts (
  customer_id TEXT PRIMARY KEY,
  agent_id TEXT,
  raw_snapshot_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_profile_facets (
  customer_id TEXT NOT NULL,
  facet TEXT NOT NULL,
  raw_snapshot_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (customer_id, facet)
);

CREATE INDEX IF NOT EXISTS idx_customer_profile_facets_captured
  ON customer_profile_facets(captured_at);
