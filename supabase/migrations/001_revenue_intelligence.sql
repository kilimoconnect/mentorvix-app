-- =============================================================================
-- MENTORVIX — Revenue Intelligence Schema
-- Migration: 001_revenue_intelligence
-- =============================================================================
-- Tables
--   applications          top-level entity per user per application
--   ai_conversations      intake chat + per-stream driver chats
--   revenue_streams       detected income sources
--   stream_items          item-level data (product/SKU/tier/unit) per stream
--   forecast_configs      start date + horizon preference
--   projection_snapshots  saved computed projections (immutable, point-in-time)
-- Views
--   application_summaries  dashboard roll-up per application
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0. Helper trigger: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 1. APPLICATIONS
--    One row per funding/assessment application.
--    A user may have multiple applications (different businesses, re-attempts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- User-facing name, auto-generated or user-set
  name          TEXT,                           -- e.g. "Hilty Paints — 2025"

  -- Workflow progress flags
  status        TEXT        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','under_review','approved','rejected')),
  intake_done   BOOLEAN     NOT NULL DEFAULT FALSE,  -- AI intake chat complete
  drivers_done  BOOLEAN     NOT NULL DEFAULT FALSE,  -- all stream items collected
  forecast_done BOOLEAN     NOT NULL DEFAULT FALSE,  -- projection saved at least once

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications(status);

CREATE TRIGGER tr_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. AI CONVERSATIONS
--    Stores the full message history for:
--      type = 'intake'  → the business understanding chat (Step 0)
--      type = 'driver'  → per-stream item collection chat  (Step 2, AI Chat mode)
--    Messages are stored as a JSONB array: [{role, content}, ...]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,

  type           TEXT        NOT NULL CHECK (type IN ('intake','driver')),

  -- NULL for intake conversations; set to the stream UUID for driver conversations
  stream_id      UUID,

  -- Full message array: [{role: "user"|"assistant", content: "..."}]
  messages       JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Which AI provider handled this conversation
  provider       TEXT        CHECK (provider IN ('openai','gemini')),

  -- True once AI emitted [STREAMS_DETECTED] or [ITEMS_DETECTED]
  is_complete    BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_application_id ON ai_conversations(application_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user_id        ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_stream_id      ON ai_conversations(stream_id)
  WHERE stream_id IS NOT NULL;

CREATE TRIGGER tr_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 3. REVENUE STREAMS
--    Each detected income source becomes one row.
--    Stream-type-specific parameters stored inline (NULL = not applicable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_streams (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,

  name           TEXT        NOT NULL,
  type           TEXT        NOT NULL
                             CHECK (type IN (
                               'product','service','subscription',
                               'rental','marketplace','contract','custom'
                             )),
  confidence     TEXT        NOT NULL DEFAULT 'medium'
                             CHECK (confidence IN ('high','medium','low')),

  -- Growth slider (all types except subscription, which uses churn model)
  monthly_growth_pct    NUMERIC(5,2) NOT NULL DEFAULT 2.00,

  -- Subscription-specific: churn model
  --   Subscribers_t = Subscribers_{t-1} + sub_new_per_month - round(Subscribers_{t-1} * sub_churn_pct/100)
  sub_new_per_month     INTEGER      NOT NULL DEFAULT 0,
  sub_churn_pct         NUMERIC(5,2) NOT NULL DEFAULT 0.00,

  -- Rental-specific: effective revenue = units × rate × (occupancy/100)
  rental_occupancy_pct  NUMERIC(5,2) NOT NULL DEFAULT 100.00,

  -- Whether AI has finished collecting items for this stream
  driver_done    BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Display order in the UI
  position       INTEGER     NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_streams_application_id ON revenue_streams(application_id);
CREATE INDEX IF NOT EXISTS idx_revenue_streams_user_id        ON revenue_streams(user_id);

CREATE TRIGGER tr_revenue_streams_updated_at
  BEFORE UPDATE ON revenue_streams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Now we can add the FK from ai_conversations → revenue_streams
ALTER TABLE ai_conversations
  ADD CONSTRAINT fk_ai_conv_stream
  FOREIGN KEY (stream_id) REFERENCES revenue_streams(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- 4. STREAM ITEMS
--    Item-level data: one row per product / SKU / service / tier / rental unit.
--    Revenue formula depends on the parent stream's type:
--      product / service / contract / custom  → volume × price
--      subscription                           → volume (subscribers) × price (monthly fee)
--      rental                                 → volume × price × occupancy%
--      marketplace                            → volume (GMV) × (price/100) (commission %)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stream_items (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id  UUID        NOT NULL REFERENCES revenue_streams(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,

  name       TEXT        NOT NULL,
  category   TEXT        NOT NULL DEFAULT 'General',

  -- Meaning of volume & price depends on stream type (see formula above)
  volume     NUMERIC(14,2) NOT NULL DEFAULT 0,
  price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit       TEXT          NOT NULL DEFAULT 'unit',   -- "can","subscriber","contract", etc.
  note       TEXT,

  -- Display order within the stream
  position   INTEGER     NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_items_stream_id ON stream_items(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_items_user_id   ON stream_items(user_id);

CREATE TRIGGER tr_stream_items_updated_at
  BEFORE UPDATE ON stream_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 5. FORECAST CONFIGS
--    User's chosen start date and time horizon for the projection.
--    One config per application (upsert on save).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_configs (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID    NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        UUID    NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,

  -- Month index 0–11 (January = 0)
  start_month    INTEGER NOT NULL DEFAULT 0
                         CHECK (start_month BETWEEN 0 AND 11),
  start_year     INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,

  -- Horizon in years: 1, 3, 5, 10, or 30
  horizon_years  INTEGER NOT NULL DEFAULT 3,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only one config per application
  CONSTRAINT uq_forecast_config_application UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_configs_application_id ON forecast_configs(application_id);
CREATE INDEX IF NOT EXISTS idx_forecast_configs_user_id        ON forecast_configs(user_id);

CREATE TRIGGER tr_forecast_configs_updated_at
  BEFORE UPDATE ON forecast_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 6. PROJECTION SNAPSHOTS
--    Immutable point-in-time saves of the computed revenue projection.
--    New snapshot created on every "Save & Continue" click.
--    Keeps full history so user can revert to a previous forecast.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projection_snapshots (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id            UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  forecast_config_id UUID        REFERENCES forecast_configs(id) ON DELETE SET NULL,

  -- Pre-computed KPIs for fast dashboard display (no need to parse snapshot_data)
  monthly_baseline   NUMERIC(14,2),   -- current MRR across all streams
  year1_revenue      NUMERIC(14,2),   -- first 12 months total
  total_revenue      NUMERIC(14,2),   -- grand total over full horizon
  final_year_revenue NUMERIC(14,2),   -- last year total

  -- Full month-by-month array: ProjMonth[]
  -- Structure: [{index, year, monthLabel, yearMonth, total, byStream:[{id,name,type,rev,byCategory:{}}]}]
  -- TOAST-compressed automatically by PostgreSQL for large payloads (30yr = ~360 rows × N streams)
  snapshot_data      JSONB       NOT NULL,

  -- Snapshots are immutable — no updated_at
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proj_snapshots_application_id ON projection_snapshots(application_id);
CREATE INDEX IF NOT EXISTS idx_proj_snapshots_user_id        ON projection_snapshots(user_id);
-- Latest snapshot per application (dashboard uses this)
CREATE INDEX IF NOT EXISTS idx_proj_snapshots_created_at     ON projection_snapshots(application_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 7. ROW-LEVEL SECURITY
--    Every user can only read and write their own rows.
-- ---------------------------------------------------------------------------

ALTER TABLE applications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_streams      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_configs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection_snapshots ENABLE ROW LEVEL SECURITY;

-- Applications
CREATE POLICY "own_applications" ON applications
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- AI Conversations
CREATE POLICY "own_ai_conversations" ON ai_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Revenue Streams
CREATE POLICY "own_revenue_streams" ON revenue_streams
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Stream Items
CREATE POLICY "own_stream_items" ON stream_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Forecast Configs
CREATE POLICY "own_forecast_configs" ON forecast_configs
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Projection Snapshots
CREATE POLICY "own_projection_snapshots" ON projection_snapshots
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 8. CONVENIENCE VIEW: application_summaries
--    Used by the dashboard to show application cards with roll-up metrics.
--    Joins to the latest snapshot for KPIs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW application_summaries AS
SELECT
  a.id,
  a.user_id,
  a.name,
  a.status,
  a.intake_done,
  a.drivers_done,
  a.forecast_done,
  a.created_at,
  a.updated_at,

  -- Stream & item counts
  COUNT(DISTINCT rs.id)   AS stream_count,
  COUNT(DISTINCT si.id)   AS item_count,

  -- Rough current MRR (sum of all items across all streams)
  COALESCE(
    SUM(
      CASE rs.type
        WHEN 'marketplace' THEN si.volume * (si.price / 100)
        WHEN 'rental'      THEN si.volume * si.price * (rs.rental_occupancy_pct / 100)
        ELSE                    si.volume * si.price
      END
    ), 0
  ) AS estimated_mrr,

  -- Latest snapshot KPIs (NULL if no forecast saved yet)
  ps.monthly_baseline,
  ps.year1_revenue,
  ps.total_revenue,
  ps.final_year_revenue

FROM applications a
LEFT JOIN revenue_streams      rs ON rs.application_id = a.id
LEFT JOIN stream_items         si ON si.stream_id = rs.id
-- Latest snapshot only
LEFT JOIN LATERAL (
  SELECT monthly_baseline, year1_revenue, total_revenue, final_year_revenue
  FROM   projection_snapshots
  WHERE  application_id = a.id
  ORDER  BY created_at DESC
  LIMIT  1
) ps ON TRUE
GROUP BY
  a.id, a.user_id, a.name, a.status,
  a.intake_done, a.drivers_done, a.forecast_done,
  a.created_at, a.updated_at,
  ps.monthly_baseline, ps.year1_revenue, ps.total_revenue, ps.final_year_revenue;
