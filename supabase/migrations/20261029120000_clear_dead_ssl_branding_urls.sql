-- SEO-01: clear the seeded SSL tenant's dead branding asset URLs.
--
-- The SSL tenant seed set logo_url / favicon_url to https://ssl.cricket/...,
-- a domain that does not resolve. The live site therefore advertised
-- <link rel="icon" href="https://ssl.cricket/favicon.ico">: browsers and
-- Google's search-result favicon fetch failed, and the home header / Organization
-- JSON-LD would point at a broken logo.
--
-- NULL means "no tenant asset", which falls back to the platform icon set
-- (/favicon.ico, /icons/*) shipped with the web app. Only the exact seeded
-- values are touched, so a logo an owner has since uploaded is left alone.
-- Idempotent.

UPDATE tenant_branding
SET logo_url = NULL, updated_at = now()
WHERE logo_url = 'https://ssl.cricket/logo.png';

UPDATE tenant_branding
SET favicon_url = NULL, updated_at = now()
WHERE favicon_url = 'https://ssl.cricket/favicon.ico';
