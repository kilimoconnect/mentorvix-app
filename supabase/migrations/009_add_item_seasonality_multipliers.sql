-- =============================================================================
-- MENTORVIX — Migration 009
-- Add per-item seasonality multipliers to stream_items
-- Allows custom 12-month pattern overrides at the item level,
-- matching the stream-level seasonality_multipliers column.
-- =============================================================================

ALTER TABLE stream_items
  ADD COLUMN IF NOT EXISTS seasonality_multipliers JSONB;
