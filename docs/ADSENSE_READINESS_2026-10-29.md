# Google AdSense Readiness — cricketleague.tech

Audit date: 2026-10-29 (live site `https://www.cricketleague.tech` + `main` @ `b068775`)

## Verdict: NOT READY — do not apply yet

If you apply today the most likely result is **rejection for "Low value content"**
and/or **"Site does not comply with Google policies"** (missing privacy policy).
A rejection is not permanent, but each re-review takes 1–4 weeks, so fix the
blockers below first and apply once.

| # | Requirement | Status | Severity |
|---|---|---|---|
| 1 | Privacy Policy page (must mention cookies + Google ads) | ❌ missing — `/privacy` redirects to sign-in | **Blocker** |
| 2 | Enough original, useful public content | ❌ thin — `/hub` lists 1 league, `/leaderboards` ~empty, home ≈ 365 words | **Blocker** |
| 3 | About page | ❌ missing | **Blocker** (reviewers check who runs the site) |
| 4 | Contact page | ❌ missing | **Blocker** |
| 5 | Terms of Service page | ❌ missing | High |
| 6 | Unknown URLs return 404, not a login wall | ❌ every unknown path (even `/ads.txt`) 307s to `/sign-in` | High |
| 7 | `ads.txt` served at the domain root | ❌ missing (and currently redirected to sign-in) | Required after approval |
| 8 | Most of the site visible without login | ⚠️ the valuable parts (scoring, teams, dashboard) are login-only; reviewers only see public pages | High |
| 9 | Clear navigation, no broken links | ⚠️ fixed in `212e6c2`/`b068775` (mobile menu, `/tournaments` + `/hall-of-fame` public) — **needs deploy** | Medium |
| 10 | Site icon / branding works | ⚠️ fixed in `c6802d9` + migration `20261029120000_clear_dead_ssl_branding_urls.sql` — **needs deploy + migration run** | Medium |
| 11 | Consent banner (Google-certified CMP) for EEA/UK/Swiss visitors | ❌ none | Required before ads show to EU/UK users |
| 12 | Custom top-level domain, HTTPS, mobile friendly | ✅ | — |
| 13 | Indexed by Google | ⚠️ only for the brand/domain query — see Search Console steps below | Medium |
| 14 | No prohibited content (copyright, adult, gambling, misleading claims) | ✅ — and the unprovable "Pakistan's #1" title was removed in `b068775` | — |

## Why "low value content" is the real risk

AdSense approves **sites that publishers read**, not tools people log into.
An AdSense reviewer (a crawler first, then sometimes a human) only sees what is
public. Today that is: one landing page, a hub with one league, near-empty
leaderboards and a hall of fame. To Google that looks like a template/SaaS shell.

What counts as content Google wants to monetize:

- Public **match pages** with full scorecards and ball-by-ball commentary
  (`/matches/<id>`) — each completed match is a unique, indexable page.
- Public **tournament pages** with points tables, fixtures, results.
- **Player career pages** (`/hub/players/<id>`) with stats.
- **Written articles**: match reports, "how to run a cricket league", scoring
  rules (wides/no-balls/DLS explained), net-run-rate explained, tape-ball
  tournament guides. Original text, 600–1,500 words each.

Rough target before applying: **25–30+ substantial public pages** with
original text, plus real published matches/tournaments that have data.

## Step-by-step plan

### Phase 1 — Policy pages (code; ~1 day)

Add public routes (and to `isPublicRoute` in `apps/web/src/middleware.ts`,
the footer, and `TENANT_ROUTES`/`PLATFORM_ROUTES` in `apps/web/src/app/sitemap.ts`):

| Route | Must contain |
|---|---|
| `/privacy` | What data you collect (account, email, phone, match data), cookies, **third-party vendors including Google use cookies to serve ads based on prior visits; users can opt out at https://www.google.com/settings/ads**, analytics, data retention, contact for deletion requests, children's data |
| `/terms` | Acceptable use, accounts, league/organizer responsibilities, payments (if any), liability, governing law (Pakistan) |
| `/about` | Who runs the platform (a real person/company name), mission, what the product does, location |
| `/contact` | Working email address (and optionally a form, WhatsApp, address). Reviewers do check it is real |

Use plain, honest text. Do not copy another site's policy word-for-word.
Because the platform is white-label, the tenant's brand name should appear
via `resolveBrandName(brand)` while the legal operator stays the platform owner.

### Phase 2 — Make every non-existent URL a real 404 (code; ~1 hour)

The Clerk middleware currently treats every path not in the allow-list as
protected, so `/random-page` → `/sign-in`. Crawlers read that as "the whole
site is a login wall". Only `/dashboard`, `/settings`, `/broadcast`,
`/actions`, `/impersonation` and the authenticated API routes need protection
— consider inverting the matcher to a **protected-route list** so unknown paths
fall through to `not-found.tsx` (404).

### Phase 3 — Content (non-code; 4–8 weeks, the part that decides approval)

1. Publish real tournaments and score real matches so public match,
   tournament and player pages fill with data.
2. Add a **blog / guides** section (e.g. `/guides/<slug>`), statically
   rendered, linked from the home page and footer, listed in the sitemap.
   Write at least **15–20 original articles** before applying. Ideas:
   - How to organize a cricket tournament (step-by-step)
   - Cricket scoring rules for beginners: wides, no-balls, byes, leg-byes
   - Net run rate explained with a worked example
   - Tape-ball cricket tournament rules in Pakistan
   - How to choose a tournament format: league, groups, knockouts
   - Match reports for every final played on the platform
3. Do NOT use AI-spun, copied or auto-generated filler pages — that is an
   explicit rejection reason ("scraped / low value content").

### Phase 4 — Google Search Console (non-code; 15 minutes, then wait)

1. Deploy the current `main` and run the migration
   `supabase/migrations/20261029120000_clear_dead_ssl_branding_urls.sql`.
2. Add `https://www.cricketleague.tech` to Search Console, verify via DNS.
3. Submit `https://www.cricketleague.tech/sitemap.xml`.
4. Wait until the **Pages** report shows your public pages as *Indexed*
   (typically 1–4 weeks). AdSense reviewers effectively need the pages to be
   crawlable; an un-indexed site often gets "site down or unavailable".

### Phase 5 — Apply

Requirements on your side: you are 18+, one AdSense account per person,
the payee name must match your bank account / CNIC exactly.

1. Go to https://adsense.google.com → *Get started* → enter
   `cricketleague.tech` (no `www`, no `https://`).
2. AdSense gives you a snippet like:
   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
   ```
   Add it once, site-wide, in `apps/web/src/app/layout.tsx` using
   `next/script` with `strategy="afterInteractive"`. Load it **only on
   public pages** (never inside `/dashboard` or the scorer view — ads there
   would hurt scorers and organizers who pay you).
   Your Content-Security-Policy (if any) must allow
   `pagead2.googlesyndication.com`, `googleads.g.doubleclick.net`,
   `tpc.googlesyndication.com` and `*.adtrafficquality.google`.
3. Add `ads.txt` at `apps/web/public/ads.txt`:
   ```
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```
   and add `/ads.txt` to `isPublicRoute` in `middleware.ts` (today it is
   redirected to sign-in, which AdSense reports as "ads.txt not found").
   Check it with `curl https://www.cricketleague.tech/ads.txt`.
4. In AdSense → *Privacy & messaging* → enable the **Google-certified CMP**
   (European regulations message) — free and required for EEA/UK/Swiss
   traffic. Update the Privacy Policy to mention it.
5. Click *Request review*. Leave the code in place during review (2 days –
   4 weeks). Do not click your own ads, ever, or ask others to.

### Phase 6 — After approval

- Prefer manual ad units on public content pages (match centre, tournament,
  hub, guides) over full Auto Ads, so the live scoreboard is never pushed
  around by an ad loading (layout shift hurts both UX and SEO).
- Never place ads in the scorer UI, broadcast overlays (`/broadcast`), or
  next to buttons where accidental clicks are likely — invalid-click policy.
- White-label tenants with `hideSslBranding` (Pro/Enterprise) should get
  **no platform ads** on their domains; gate the ad script on that flag.
  Each tenant custom domain would also need to be added to AdSense *Sites*
  separately if ads ever run there.

## Common rejection messages and the fix

| AdSense says | Means | Fix |
|---|---|---|
| Low value content | Not enough original, useful public text | Phase 3 |
| Site down or unavailable | Crawler hit a redirect/login or the page did not load | Phase 2 + Phase 4; make sure the AdSense snippet page loads without login |
| Site does not comply with Google policies | Usually missing privacy policy, or copied/misleading content | Phase 1 |
| Navigation issues | Broken links, menus that do not work, empty pages | Deploy the mobile menu fix; remove links to empty pages |
| ads.txt not found / Earnings at risk | `ads.txt` missing or wrong publisher ID | Phase 5 step 3 |

## Realistic timeline

| Week | Milestone |
|---|---|
| 0 | Deploy current fixes, run migration, set up Search Console |
| 1 | Privacy / Terms / About / Contact live; 404 behaviour fixed |
| 1–6 | Publish 15–20 guides; real tournaments and matches published |
| 6–8 | Pages indexed in Search Console → apply to AdSense |
| 8–10 | Review decision |
