-- Migration 0016: Idempotency keys + covering indexes
-- Prevents duplicate wagers from overlapping cron runs and replays.
-- Idempotency key = endpoint + wager_number + agent_id

-- bet_ticker_wagers
ALTER TABLE bet_ticker_wagers ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bet_ticker_idempotency
  ON bet_ticker_wagers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bet_ticker_login_captured
  ON bet_ticker_wagers(login, captured_at DESC);

-- graded_wagers
ALTER TABLE graded_wagers ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_graded_idempotency
  ON graded_wagers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_graded_login_captured
  ON graded_wagers(login, captured_at DESC);

-- prop_wagers
ALTER TABLE prop_wagers ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_idempotency
  ON prop_wagers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_prop_login_captured
  ON prop_wagers(login, captured_at DESC);
