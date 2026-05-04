-- =============================================================================
-- MENTORVIX — Migration 010
-- Persist Advanced Override rules on revenue_streams as a JSONB array.
-- Each element is a serialised GrowthOverride object (scope, targetId,
-- targetName, volumeGrowthPct, annualPriceGrowthPct, seasonalityPreset,
-- seasonalityMultipliers, launchMonth, sunsetMonth).
-- NULL = no override rules defined for this stream.
-- =============================================================================

ALTER TABLE revenue_streams
  ADD COLUMN IF NOT EXISTS item_overrides JSONB;
