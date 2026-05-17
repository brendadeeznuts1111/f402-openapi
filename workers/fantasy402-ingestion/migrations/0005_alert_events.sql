CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_events_created
  ON alert_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_type_created
  ON alert_events(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_severity_created
  ON alert_events(severity, created_at DESC);
