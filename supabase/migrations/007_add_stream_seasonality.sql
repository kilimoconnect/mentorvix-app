-- =============================================================================
-- MENTORVIX — Migration 007
-- Add stream-level seasonality to revenue_streams
--   seasonality_preset     — preset key (none|q4_peak|custom|…)
--   seasonality_multipliers — 12-element JSON array of monthly multipliers
-- =============================================================================

ALTER TABLE revenue_streams
  ADD COLUMN IF NOT EXISTS seasonality_preset      TEXT    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS seasonality_multipliers JSONB   DEFAULT NULL;

-- NULL multipliers = use preset defaults; only stored when preset = 'custom'
-- or when the user has edited individual months.
