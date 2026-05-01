-- =============================================================================
-- MENTORVIX — Migration 006
-- Add cost_price to stream_items (COGS per unit)
-- Add operating_expenses table (monthly OpEx for income statement)
-- Add business_profile table (employees, premises, loan ask, collateral)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. cost_price on stream_items
--    Gross Margin per item = (price - cost_price) × volume
--    NULL = cost unknown (treated as 0 in projection engine)
-- ---------------------------------------------------------------------------
ALTER TABLE stream_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2) DEFAULT NULL;


-- ---------------------------------------------------------------------------
-- 2. OPERATING EXPENSES
--    One row per expense category per application.
--    Feeds the income statement: Gross Profit − OpEx = EBITDA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operating_expenses (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID          NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,

  -- e.g. "Salaries", "Rent", "Utilities", "Transport", "Marketing", "Admin", "Insurance"
  category       TEXT          NOT NULL,

  -- Monthly amount in the application's currency
  monthly_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Optional note captured during AI conversation
  note           TEXT,

  -- Display order
  position       INTEGER       NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_opex_app_category UNIQUE (application_id, category)
);

CREATE INDEX IF NOT EXISTS idx_opex_application_id ON operating_expenses(application_id);
CREATE INDEX IF NOT EXISTS idx_opex_user_id         ON operating_expenses(user_id);

CREATE TRIGGER tr_operating_expenses_updated_at
  BEFORE UPDATE ON operating_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE operating_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_operating_expenses" ON operating_expenses
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 3. BUSINESS PROFILE
--    One row per application — captures facts needed for:
--      • Business plan (employees, description, market, competitive advantage)
--      • Loan documents (loan ask, purpose, collateral, registration)
--      • Balance sheet inputs (existing debt, owner equity, assets summary)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,

  -- Workforce
  employee_count       INTEGER,         -- total headcount
  employee_cost_monthly NUMERIC(14,2),  -- total monthly salary/wages

  -- Premises
  premises_type        TEXT CHECK (premises_type IN ('owned','rented','shared','none')),
  premises_monthly_cost NUMERIC(14,2),  -- rent if rented; NULL if owned

  -- Existing debt
  existing_loans_total NUMERIC(16,2),   -- total outstanding loan balance
  existing_monthly_repayment NUMERIC(14,2),

  -- Loan request (this application)
  loan_amount_requested NUMERIC(16,2),
  loan_purpose          TEXT,
  loan_term_months      INTEGER,        -- requested repayment period in months
  collateral_description TEXT,

  -- Business registration
  business_reg_number   TEXT,
  years_operating       NUMERIC(4,1),   -- e.g. 2.5 = 2½ years; 0 = startup

  -- Business plan narrative fields (AI-extracted summaries)
  business_description  TEXT,           -- 1–2 sentence overview
  target_market         TEXT,           -- who they sell to
  competitive_advantage TEXT,           -- what makes them different

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_profile_application UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_bizprofile_application_id ON business_profiles(application_id);
CREATE INDEX IF NOT EXISTS idx_bizprofile_user_id         ON business_profiles(user_id);

CREATE TRIGGER tr_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_business_profiles" ON business_profiles
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 4. Add 'expenses' and 'bizprofile' as valid ai_conversation types
-- ---------------------------------------------------------------------------
ALTER TABLE ai_conversations
  DROP CONSTRAINT IF EXISTS ai_conversations_type_check;

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_type_check
  CHECK (type IN ('intake','driver','expenses','bizprofile'));
