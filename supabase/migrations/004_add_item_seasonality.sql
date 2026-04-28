-- =============================================================================
-- MENTORVIX — Migration 004
-- Add per-item seasonality preset to stream_items
-- =============================================================================

-- seasonality_preset: optional SeasonalityPreset key (none|q4_peak|q1_slow|
--   summer_peak|end_of_year|construction|custom).  NULL = inherit from stream.
ALTER TABLE stream_items
  ADD COLUMN IF NOT EXISTS seasonality_preset TEXT;
