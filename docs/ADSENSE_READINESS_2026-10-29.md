# Google AdSense Readiness — cricketleague.tech

Operator: **MTK Codex**, Lahore, Pakistan · contact `kaash0542@gmail.com`
See also: [`SEO_GROWTH_GUIDE_2026-10-29.md`](./SEO_GROWTH_GUIDE_2026-10-29.md) for Search Console, keywords and backlinks.
First audit: 2026-10-29 (live site). Code updated the same day.

## Status

All the **code** AdSense reviewers check is now in place. What is left is
**deploying, configuration and time** (indexing + real content), listed in
"What you must do" below. Do not apply until every box in the final
checklist is ticked.

| # | Requirement | Status |
|---|---|---|
| 1 | Privacy Policy with cookies + Google ads disclosure | ✅ `/privacy` (Google's required wording, opt-out links, consent, children, rights) |
| 2 | About page naming the operator | ✅ `/about` |
| 3 | Contact page with a working email | ✅ `/contact` (+ ContactPage structured data) |
| 4 | Terms of Service | ✅ `/terms` (governing law Pakistan, courts of Lahore) |
| 5 | Original, useful public content | ✅ 8 long-form guides at `/guides` (450+ words each, test-enforced) — **add more over time** |
| 6 | Unknown URLs return 404, not a login wall | ✅ middleware now protects only private areas; unknown paths 404 |
| 7 | Navigation on every public page | ✅ shared header/footer on guides, policies, hub, tournaments, leaderboards, hall of fame; mobile menu |
| 8 | `ads.txt` | ✅ `/ads.txt` generated from the publisher id (404 until configured) |
| 9 | AdSense code + site verification meta tag | ✅ loads only when configured, only on public pages |
| 10 | Consent (EEA/UK/CH) | ✅ code ready ("Cookie settings" footer link reopens Google's CMP) — **you enable the CMP in AdSense** |
| 11 | Ads kept out of the product | ✅ never on dashboard, settings, scorer view, broadcast, sign-in/up, invites; never for tenants with `hideSslBranding` |
| 12 | Site icon, SEO metadata, sitemap | ✅ earlier commits; sitemap now includes guides + policy pages |
| 13 | Indexed by Google | ⏳ needs deploy + Search Console (below) |
| 14 | Real league activity on public pages | ⏳ publish real tournaments and matches |

## What was built (for developers)

| Piece | Where |
|---|---|
| Operator details (single source) | `apps/web/src/lib/legal.ts` |
| Policy pages | `apps/web/src/app/{privacy,terms,about,contact}/page.tsx` |
| Guides content (add articles here) | `apps/web/src/content/guides.ts` |
| Guides pages (index + article, Article/Breadcrumb JSON-LD, TOC, related) | `apps/web/src/app/guides/` |
| Public header/footer | `apps/web/src/components/public/` |
| AdSense config, path rules | `apps/web/src/lib/adsense.ts` |
| Ad script + ad unit component | `apps/web/src/components/ads/adsense.tsx` |
| `ads.txt` | `apps/web/src/app/ads.txt/route.ts` |
| Public/private route rules | `apps/web/src/middleware.ts` (`isPublicRoute` / `isPrivateRoute`) |
| Guard tests | `__tests__/middleware-route-coverage`, `adsense-config`, `guides-content` |

**Adding a new top-level route:** add it to `isPublicRoute` or `isPrivateRoute`
in `middleware.ts` *and* to the matching list in
`__tests__/middleware-route-coverage.test.ts`, or the test fails. This stops a
new private page from being accidentally public.

**Adding a guide:** append an entry to `GUIDES` in `content/guides.ts`. It
appears on `/guides`, gets its own page, and is added to the sitemap
automatically. Tests require 450+ words, a 100–165 character description,
3+ sections and valid internal links.

## What you must do

### Step 1 — Deploy (today)

1. Push `main` and deploy.
2. Run the migration `supabase/migrations/20261029120000_clear_dead_ssl_branding_urls.sql`
   (fixes the broken site icon).
3. Check these all load **without signing in**:
   `/guides`, one guide, `/about`, `/contact`, `/privacy`, `/terms`,
   `/tournaments`, `/hall-of-fame`, and that `/some-random-page` shows the
   404 page, not sign-in.

### Step 2 — Google Search Console (today, then wait 1–4 weeks)

1. https://search.google.com/search-console → add `https://www.cricketleague.tech`
   → verify (DNS record at your domain registrar).
2. *Sitemaps* → submit `sitemap.xml`.
3. *URL inspection* → request indexing for `/`, `/guides` and each guide.
4. Wait until *Pages* shows the guides as **Indexed**.

### Step 3 — Content and activity (weeks 1–6)

- Publish real tournaments and score real matches so the hub, tournament,
  match and leaderboard pages have real data.
- Read the 8 guides and adjust anything that differs from how your leagues
  play. Add your own experience and examples; first-hand detail is what
  Google rewards most.
- Aim for **15–20 guides** before applying. Ideas: match-day checklist,
  choosing a scorer, DLS basics for club cricket, Super Over rules, how to
  write playing conditions, a report for every final you host.
- Never paste copied or bulk AI-generated text. "Scaled content" is a
  rejection reason and an SEO penalty.

### Step 4 — Apply to AdSense

You must be 18+, and the payee name must match your bank account / CNIC.

1. https://adsense.google.com → *Get started* → site `cricketleague.tech`.
2. Copy your publisher id (`ca-pub-` followed by 16 digits).
3. Set it in the production environment **before building** (it is a
   `NEXT_PUBLIC_` variable, inlined at build time):
   ```
   NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
   ```
   Rebuild and deploy. This one setting enables:
   - the `<meta name="google-adsense-account">` verification tag,
   - the AdSense script on public pages,
   - `https://www.cricketleague.tech/ads.txt` (check it in a browser).
4. In AdSense choose the **meta tag** or **ads.txt** verification option;
   both are already live.
5. AdSense → *Privacy & messaging* → **European regulations** → create and
   publish the message (Google's certified CMP). Optionally also the
   *US state regulations* message.
6. AdSense → *Ads* → *By site* → keep **Auto ads OFF**. Placements are
   controlled in code so ads never land in the scorer or dashboard.
7. *Request review*. It takes from a few days to about 4 weeks. Keep the
   site up and unchanged in structure during review.

### Step 5 — After approval

1. AdSense → *Ads* → *By ad unit* → create a **Display ad** (responsive).
   Copy its slot id (the number in `data-ad-slot`).
2. Set `NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE=<slot id>` and redeploy. An ad
   then appears after each guide article, clearly labelled
   "Advertisement", with its space reserved so the page does not jump.
3. Never click your own ads or ask anyone to. Invalid clicks get accounts
   closed permanently.
4. Check *Policy center* in AdSense weekly for the first months.

## Final checklist before you click "Request review"

- [ ] Latest `main` deployed, migration run
- [ ] All public pages load signed-out; random URLs show the 404 page
- [ ] Search Console shows `/` and the guides as Indexed
- [ ] 15+ guides published, reviewed by you
- [ ] At least a few real tournaments with completed, published matches
- [ ] `NEXT_PUBLIC_ADSENSE_CLIENT` set and site rebuilt
- [ ] `/ads.txt` shows your `pub-` id
- [ ] View page source on `/` contains `google-adsense-account`
- [ ] European regulations consent message published in AdSense
- [ ] Contact email `kaash0542@gmail.com` is monitored

## Common rejection messages and the fix

| AdSense says | Means | Fix |
|---|---|---|
| Low value content | Not enough original, useful public text | More guides, real league data; Step 3 |
| Site down or unavailable | Crawler could not load pages | Check deploy; pages must load signed-out |
| Site does not comply with Google policies | Policy page missing or content problem | Pages exist; check nothing copied or misleading |
| Navigation issues | Broken links or empty pages | Remove links to empty sections; check the 404 page |
| ads.txt not found | Publisher id not set or wrong | Step 4.3; `/ads.txt` must show `pub-…` |

Rejected? Fix the stated reason, wait at least a week, then request review
again. There is no penalty for re-applying.
