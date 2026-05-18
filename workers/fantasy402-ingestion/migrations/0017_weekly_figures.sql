-- Weekly figure data from getWeeklyFigureByAgent endpoint
CREATE TABLE IF NOT EXISTS weekly_figures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  week INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'O',
  figure_date TEXT,
  wager_count INTEGER DEFAULT 0,
  volume INTEGER DEFAULT 0,
  net_amount INTEGER DEFAULT 0,
  big_wagers INTEGER DEFAULT 0,
  raw_json TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_figures_agent ON weekly_figures(agent_id, week);
CREATE INDEX IF NOT EXISTS idx_weekly_figures_date ON weekly_figures(figure_date);
