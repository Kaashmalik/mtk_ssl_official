-- Tax invoices / receipts for settled subscription payments.

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_number text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  subscription_id uuid,
  status text NOT NULL DEFAULT 'issued',
  currency text NOT NULL DEFAULT 'PKR',
  subtotal numeric(12,2) NOT NULL,
  tax_rate numeric(5,2) DEFAULT 0,
  tax_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) NOT NULL,
  amount_paid numeric(12,2) DEFAULT 0,
  description text,
  plan text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'paid', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, created_at);

-- Sequential, race-safe invoice numbering.
-- ssl_invoice_counter(year) holds the last sequence used for that year.
CREATE TABLE IF NOT EXISTS ssl_invoice_counter (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_invoice_number(p_year integer)
RETURNS text AS $$
DECLARE
  next_val integer;
BEGIN
  INSERT INTO ssl_invoice_counter (year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_value = ssl_invoice_counter.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'SSL-INV-' || p_year::text || '-' || lpad(next_val::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Platform-only access: invoices are financial records.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invoices FROM PUBLIC;
REVOKE ALL ON TABLE public.invoices FROM anon;
REVOKE ALL ON TABLE public.invoices FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO ssl;
  END IF;
END $$;