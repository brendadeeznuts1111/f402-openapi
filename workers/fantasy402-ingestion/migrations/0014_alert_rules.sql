CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT '*',
  metric TEXT NOT NULL CHECK (metric IN ('wager_amount', 'agent_volume', 'agent_loss', 'agent_wager_count', 'total_volume', 'win_rate')),
  operator TEXT NOT NULL CHECK (operator IN ('gt', 'lt', 'gte', 'lte')),
  threshold INTEGER NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules(enabled);

CREATE TABLE IF NOT EXISTS alert_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  actual_value INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  operator TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_log_created
  ON alert_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_log_rule
  ON alert_log(rule_id);

CREATE INDEX IF NOT EXISTS idx_alert_log_agent
  ON alert_log(agent_id);
