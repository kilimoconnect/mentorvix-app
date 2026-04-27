-- =============================================================================
-- MENTORVIX — Migration 002
-- Add wizard progress tracking columns to applications
-- =============================================================================

-- situation: which funding/business situation was selected (e.g. "existing", "new_business")
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS situation TEXT;

-- wizard_step: last completed wizard step (0=situation, 1=mapping, 2=confirm, 3=data, 4=forecast)
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS wizard_step INTEGER NOT NULL DEFAULT 0;

-- Update the application_summaries view to expose the new columns
-- Must drop first — CREATE OR REPLACE cannot change column order
DROP VIEW IF EXISTS application_summaries;
CREATE VIEW application_summaries AS
SELECT
  a.id,
  a.user_id,
  a.name,
  a.status,
  a.situation,
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
  a.id, a.user_id, a.name, a.status, a.situation, a.wizard_step,
  a.intake_done, a.drivers_done, a.forecast_done,
  a.created_at, a.updated_at,
  ps.monthly_baseline, ps.year1_revenue, ps.total_revenue, ps.final_year_revenue;
