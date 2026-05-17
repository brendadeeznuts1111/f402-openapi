ALTER TABLE alert_events ADD COLUMN r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_alert_events_r2_key
  ON alert_events(r2_key);
