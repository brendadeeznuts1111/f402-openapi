CREATE TABLE IF NOT EXISTS player_agents (
  customer_id TEXT PRIMARY KEY,
  login TEXT,
  name_first TEXT,
  agent_id TEXT NOT NULL,
  raw_snapshot_id TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_agents_agent
  ON player_agents(agent_id);

CREATE INDEX IF NOT EXISTS idx_player_agents_login
  ON player_agents(login);
