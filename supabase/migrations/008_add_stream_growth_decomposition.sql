-- Migration 008: store vol % and annual price % separately on revenue_streams
-- so the forecast page can restore the exact growth decomposition the user set
-- instead of treating the combined monthly rate as pure volume growth.
--
-- NULL default = old record (engine hadn't saved decomposition yet).
-- The restore path falls back to monthly_growth_pct when both are NULL.

ALTER TABLE revenue_streams
  ADD COLUMN IF NOT EXISTS volume_growth_pct       NUMERIC(6,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS annual_price_growth_pct NUMERIC(6,2) DEFAULT NULL;
