# UI/UX Industry-Level Improvement Plan

**Date:** 2026-10-25  
**Scope:** `apps/web` product experience and the shared UI foundation

## Objective

Make the cricket platform feel trustworthy and usable in real match conditions:

- clear first impression on the public landing page;
- strong contrast and visible surfaces in bright outdoor light;
- predictable navigation across dashboard routes;
- explicit loading, empty, and error states instead of blank screens;
- fast paths for organizers and scorers on small screens.

## Current risks to verify

1. The landing page may render too little content or hide content during animation.
2. Dashboard navigation needs a single active-state model and clear route affordances.
3. Route-level loading and error boundaries must be present for the primary dashboard areas.
4. Dark surfaces and muted text need contrast and hierarchy improvements.
5. Onboarding failures must be communicated as a recoverable state, not a dead end.

## Delivery phases

### Phase 0 — Baseline and safety

- Inventory the web app shell, public pages, dashboard routes, and shared tokens.
- Preserve existing authentication, tenant branding, localization, and data contracts.
- Add focused tests for the new visible states and navigation behavior.

### Phase 1 — Design foundation

- Define light-first semantic color tokens with a cricket-green primary.
- Keep dark mode supported, but ensure text, borders, and interactive states remain
  legible.
- Standardize surface, spacing, radius, focus-ring, and typography decisions in
  `globals.css` and shared UI primitives.
- Prefer reduced-motion-safe transitions; content must remain visible without animation.

### Phase 2 — Public landing experience

- Establish a clear hero with value proposition, primary CTA, secondary CTA, and
  trust/supporting metrics.
- Show product capabilities for tournaments, live scoring, teams, and analytics.
- Add a scannable workflow section and a final conversion CTA.
- Keep the page responsive and tenant-brand aware.

### Phase 3 — Dashboard shell and states

- Simplify navigation labels and make active routes obvious.
- Ensure mobile navigation exposes the highest-value destinations.
- Add consistent page headers and primary actions where the existing route supports
  them.
- Add route-level loading, error, and empty states for dashboard and matches.
- Make onboarding/setup failures actionable with retry/support paths.

### Phase 4 — Scoring and match operations

- Redesign scoring for one-hand use, large tap targets, sunlight contrast, undo, and
  resilient offline/reconnect behavior.
- Improve match list, match details, scorecard, and live-feed hierarchy.
- Add visual QA against common phone widths and desktop organizer layouts.

### Phase 5 — Quality and release

- Run type-check, lint, unit tests, and production build.
- Add Playwright coverage for sign-in/dashboard navigation, tournament creation, and
  scoring a ball.
- Check WCAG AA contrast, keyboard focus, reduced motion, RTL, and localization.
- Measure LCP and interaction readiness on a mid-range mobile profile.

## Initial implementation in this change

This first slice intentionally addresses the highest-visibility issues without
changing backend contracts:

1. Replace an overly sparse landing experience with a clear, responsive marketing
   surface using existing brand resolution and auth links.
2. Improve the global visual tokens for contrast and surface separation.
3. Make the primary dashboard navigation easier to scan.
4. Add explicit loading/error/empty behavior to the dashboard and matches entry
   points where the current app structure permits it.

## Acceptance criteria

- A first-time visitor can understand the product and find sign-up/sign-in without
  scrolling through an empty hero.
- Body text and controls have readable contrast in both light and dark themes.
- Dashboard and Matches never present an unexplained blank screen while loading or
  when data is absent.
- Existing tenant branding, locale switching, auth, and route behavior remain intact.
- `pnpm --filter @mtk/web type-check` and focused web tests pass.

## Follow-up backlog

- Validate Clerk provisioning and add a server-side ensure-user/tenant fallback.
- Add a reusable `PageHeader`, `EmptyState`, and `ErrorState` component package.
- Add visual regression screenshots for the landing page, dashboard, matches, and
  scoring modes.
- Archive superseded planning documents after confirming their decisions are no
  longer active.

## Production smoke-check — 2026-10-25

Checked:

- `https://www.cricketleague.tech/` responds successfully.
- The Vercel deployment URL is protected by Vercel authentication and is not
  suitable as the public customer URL.
- `/api/health` reaches Postgres, but reports degraded Redis, email, streaming,
  and commentary readiness.
- `/sign-in` and `/sign-up` are reachable, but production content is older than
  the current local landing-page implementation.
- `/dashboard` correctly redirects anonymous users to sign-in.
- `/robots.txt` and `/sitemap.xml` were being redirected to sign-in because
  they were missing from the middleware public-route matcher. This is fixed in
  `apps/web/src/middleware.ts` and requires a redeploy.
- `/favicon.ico` currently returns 404; the configured metadata icon paths should
  be verified in the deployed build.

Before calling production ready:

1. Redeploy the current branch to the production domain.
2. Set `REDIS_URL`, `SMTP_HOST`, `SMTP_USER`, `MEDIASOUP_ANNOUNCED_IP`,
   `STREAMING_ACCESS_TOKEN`, and `OPENAI_API_KEY` if those features are enabled.
3. Configure the Clerk production webhook with `CLERK_WEBHOOK_SECRET` and verify
   a successful `user.created` delivery.
4. Re-check `/api/health`, `/robots.txt`, `/sitemap.xml`, `/sign-in`, and the
   anonymous `/dashboard` redirect.
