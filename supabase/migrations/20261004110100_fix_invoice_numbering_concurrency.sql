-- Replace the table-backed invoice counter with a sequence.
--
-- Why: ssl_invoice_number() used INSERT ... ON CONFLICT DO UPDATE, which takes a
-- row-level lock for the rest of the transaction. Behind PgBouncer in
-- transaction pooling mode (DATABASE_URL port 6543) two concurrent calls for the
-- same year deadlocked each other, hanging the admin approval request.
--
-- A sequence is non-blocking and inherently race-free, which is what invoice
-- numbering actually requires. The year stays in the number for readability and
-- the padded counter stays globally unique via the UNIQUE index.

DROP FUNCTION IF EXISTS public.next_invoice_number(integer);

DROP TABLE IF EXISTS public.ssl_invoice_counter;

CREATE SEQUENCE IF NOT EXISTS public.ssl_invoice_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text AS $$
BEGIN
  RETURN 'SSL-INV-'
    || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-'
    || lpad(nextval('public.ssl_invoice_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.next_invoice_number() IS
  'Returns the next invoice number (SSL-INV-YYYY-NNNNNN). Non-blocking; safe under concurrency.';

-- Backwards-compatible overload for the previous (year) signature.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer)
RETURNS text AS $$
BEGIN
  RETURN 'SSL-INV-'
    || p_year::text || '-'
    || lpad(nextval('public.ssl_invoice_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;