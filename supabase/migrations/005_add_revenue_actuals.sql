-- =============================================================================
-- MENTORVIX — Migration 005
-- Add revenue_actuals table for "Existing Operating Business" flow
-- Stores per-stream, per-month historical (actual) revenue figures
-- =============================================================================

CREATE TABLE IF NOT EXISTS revenue_actuals (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id)    ON DELETE CASCADE,
  stream_id      UUID                 REFERENCES revenue_streams(id) ON DELETE SET NULL,
  user_id        UUID        NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,

  -- "YYYY-MM" — e.g. "2025-03" for March 2025
  year_month     TEXT        NOT NULL,

  -- Total actual revenue for this stream in this month
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Optional context captured during the AI conversation
  note           TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per (stream, month) pair — upsert-safe
  CONSTRAINT uq_actuals_stream_month UNIQUE (stream_id, year_month)
);

-- Allow per-application totals without a stream split
CREATE UNIQUE INDEX IF NOT EXISTS uq_actuals_app_month_no_stream
  ON revenue_actuals (application_id, year_month)
  WHERE stream_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_actuals_application_id ON revenue_actuals(application_id);
CREATE INDEX IF NOT EXISTS idx_actuals_stream_id      ON revenue_actuals(stream_id);
CREATE INDEX IF NOT EXISTS idx_actuals_user_id        ON revenue_actuals(user_id);
CREATE INDEX IF NOT EXISTS idx_actuals_year_month     ON revenue_actuals(year_month);

CREATE TRIGGER tr_revenue_actuals_updated_at
  BEFORE UPDATE ON revenue_actuals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE revenue_actuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_revenue_actuals" ON revenue_actuals
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
