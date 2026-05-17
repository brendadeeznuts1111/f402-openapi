ALTER TABLE api_snapshots ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE api_snapshots ADD COLUMN r2_etag TEXT;
ALTER TABLE api_snapshots ADD COLUMN r2_size INTEGER;
ALTER TABLE api_snapshots ADD COLUMN r2_storage_class TEXT NOT NULL DEFAULT 'InfrequentAccess';

ALTER TABLE endpoint_failures ADD COLUMN r2_key TEXT;
ALTER TABLE endpoint_failures ADD COLUMN r2_etag TEXT;
ALTER TABLE endpoint_failures ADD COLUMN r2_size INTEGER;
ALTER TABLE endpoint_failures ADD COLUMN r2_storage_class TEXT NOT NULL DEFAULT 'InfrequentAccess';

CREATE INDEX IF NOT EXISTS idx_api_snapshots_r2_key
  ON api_snapshots(r2_key);

CREATE INDEX IF NOT EXISTS idx_endpoint_failures_r2_key
  ON endpoint_failures(r2_key);
