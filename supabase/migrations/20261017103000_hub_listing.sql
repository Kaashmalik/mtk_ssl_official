-- PUB-02: publication-approved cross-league hub listing.
--
-- tenants.hub_listing_status is the LEAGUE's own publication decision to be
-- discoverable on the cross-league hub. Default 'unlisted': nothing changes
-- for existing leagues and no cross-tenant read may surface them. Listing is
-- opt-in only; hilisting row keeps the decision time for provenance. This does
-- NOT add an "unlisted link" tier: share links never replace authorization,
-- per-entity public reads stay host-tenant-scoped and lifecycle-published.
--
-- LOCAL-ONLY until separately applied with the reviewed migration chain.
-- Never run implicitly against production; no acceptance is inferred from it.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hub_listing_status') THEN
    CREATE TYPE public.hub_listing_status AS ENUM ('unlisted', 'listed');
  END IF;
END $$;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS hub_listing_status public.hub_listing_status NOT NULL DEFAULT 'unlisted';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS hub_listed_at timestamptz;

COMMENT ON COLUMN public.tenants.hub_listing_status IS
  'PUB-02 hub discoverability: the league owner''s explicit publication approval. Default unlisted = never appears in any cross-league hub read; "listed" is opt-in and reversible.';
COMMENT ON COLUMN public.tenants.hub_listed_at IS
  'When the league was last explicitly listed on the public hub. Null while unlisted; the shared hub policy fails closed when it is missing.';

COMMIT;
