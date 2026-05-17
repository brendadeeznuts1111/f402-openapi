ALTER TABLE api_snapshots ADD COLUMN trace_id TEXT;
ALTER TABLE api_snapshots ADD COLUMN duration_ms INTEGER;

ALTER TABLE endpoint_failures ADD COLUMN trace_id TEXT;
ALTER TABLE endpoint_failures ADD COLUMN duration_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_api_snapshots_trace_id
  ON api_snapshots(trace_id);

CREATE INDEX IF NOT EXISTS idx_endpoint_failures_trace_id
  ON endpoint_failures(trace_id);
