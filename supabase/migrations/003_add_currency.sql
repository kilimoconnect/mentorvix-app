-- =============================================================================
-- MENTORVIX — Migration 003
-- Add currency column to applications
-- =============================================================================

-- currency: ISO 4217 code selected by the user (e.g. 'USD', 'NGN', 'KES')
-- NULL means the user hasn't selected one yet (legacy rows before this migration).
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- Expose currency in the summaries view
DROP VIEW IF EXISTS application_summaries;
CREATE VIEW application_summaries AS
SELECT
  a.id,
  a.user_id,
  a.name,
  a.status,
  a.situation,
  a.currency,
  a.wizard_step,
  a.intake_done,
  a.drivers_done,
  a.forecast_done,
  a.created_at,
  a.updated_at,

  COUNT(DISTINCT rs.id)   AS stream_count,
  COUNT(DISTINCT si.id)   AS item_count,

  COALESCE(
    SUM(
      CASE rs.type
        WHEN 'marketplace' THEN si.volume * (si.price / 100)
        WHEN 'rental'      THEN si.volume * si.price * (rs.rental_occupancy_pct / 100)
        ELSE                    si.volume * si.price
      END
    ), 0
  ) AS estimated_mrr,

  ps.monthly_baseline,
  ps.year1_revenue,
  ps.total_revenue,
  ps.final_year_revenue

FROM applications a
LEFT JOIN revenue_streams      rs ON rs.application_id = a.id
LEFT JOIN stream_items         si ON si.stream_id = rs.id
LEFT JOIN LATERAL (
  SELECT monthly_baseline, year1_revenue, total_revenue, final_year_revenue
  FROM   projection_snapshots
  WHERE  application_id = a.id
  ORDER  BY created_at DESC
  LIMIT  1
) ps ON TRUE
GROUP BY
  a.id, a.user_id, a.name, a.status, a.situation, a.currency, a.wizard_step,
  a.intake_done, a.drivers_done, a.forecast_done,
  a.created_at, a.updated_at,
  ps.monthly_baseline, ps.year1_revenue, ps.total_revenue, ps.final_year_revenue;
