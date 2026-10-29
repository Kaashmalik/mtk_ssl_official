# SEO Growth Guide — cricketleague.tech

Companion to [`ADSENSE_READINESS_2026-10-29.md`](./ADSENSE_READINESS_2026-10-29.md).
Written 2026-10-29 after auditing the live site.

## Honest expectations

No code change can guarantee the #1 Google result. In 2026 rankings come from
three things, in this order of effort:

1. **Technical health**: Google can crawl, render and understand the site. ✅ Done in code.
2. **Content**: pages that answer what people search for, better than others. 🟡 Started (8 guides).
3. **Authority**: other real websites linking to you. ❌ Off-site work, only you can do it.

A new domain usually ranks only for its own name at first. That is where the
site was when audited. Expect **weeks to months** for non-brand keywords.

## What was fixed in code

| Problem found on the live site | Fix | Commit |
|---|---|---|
| Site icon pointed at `ssl.cricket` (domain does not resolve) | New icon set + migration clearing the dead URL | `c6802d9`, `b068775` |
| `/tournaments`, `/hall-of-fame` in sitemap but redirected to sign-in | Made public | `b068775` |
| Every unknown URL redirected to sign-in (site looked like a login wall) | Unknown paths return 404 | `76483c1` |
| Invalid URLs in structured data (`\n` from env var) | `appUrl()` trims | `b068775` |
| Sitemap listed `/sign-in` and stamped every URL "modified now" | Removed both | `b068775` |
| H1 did not contain "cricket"; unprovable "Pakistan's #1" title | Keyword-led titles, description, H1 | `b068775` |
| No FAQ, thin content, no internal links | FAQ + FAQPage data, 8 guides, shared nav/footer | `b068775`, `76483c1` |
| Public pages had no header/footer | Shared public chrome | `76483c1` |

## Step 1 — Deploy and verify (day 1)

1. Deploy latest `main`.
2. Run `supabase/migrations/20261029120000_clear_dead_ssl_branding_urls.sql`.
3. Open signed-out: `/`, `/guides`, a guide, `/about`, `/privacy`, `/tournaments`.
   Open `/some-random-page`: must show the 404 page.
4. Test structured data: https://search.google.com/test/rich-results with
   `https://www.cricketleague.tech/` and one guide URL. Expect Organization,
   FAQPage, Article and Breadcrumb with no errors.
5. Test mobile speed: https://pagespeed.web.dev with the home page. Fix
   anything red under Core Web Vitals.

## Step 2 — Google Search Console (day 1)

1. https://search.google.com/search-console → *Add property* → **Domain**
   `cricketleague.tech` → add the TXT record at your domain registrar.
2. *Sitemaps* → submit `https://www.cricketleague.tech/sitemap.xml`.
3. *URL inspection* → *Request indexing* for `/`, `/guides`, and each guide.
4. Check *Pages* weekly. Fix anything under "Not indexed" that should be indexed.
5. After 2–4 weeks, *Performance* shows which searches you appear for. Use
   them to choose the next guides.

Also add the site to **Bing Webmaster Tools** (https://www.bing.com/webmasters).
You can import it straight from Search Console. Bing also feeds several AI
search assistants.

## Step 3 — Target the right keywords

Do not chase "cricket" or "cricket league" alone. Big sites own those.
Target specific phrases where a small site can win:

| Intent | Example phrases |
|---|---|
| Product | cricket league app Pakistan, cricket tournament management software, live cricket scoring app, cricket scoring app offline |
| How-to (guides) | how to organize a cricket tournament, net run rate calculation, how to score cricket, cricket points table rules |
| Local | cricket league Lahore, tape ball tournament Lahore, cricket tournament Karachi |
| Brand | Shakir Super League, cricketleague.tech |

Each guide should target one main phrase in its title, H1, description and
first paragraph. That is already done for the existing 8.

## Step 4 — Grow content (ongoing, 1–2 new guides per week)

- Add guides in `apps/web/src/content/guides.ts`. The sitemap, index page
  and tests pick them up automatically.
- Write from real experience: photos, real scorecards, mistakes you have seen.
  First-hand detail is what Google's 2026 "helpful content" systems reward.
- Next topics: match-day checklist, choosing and training scorers, DLS
  basics for club cricket, Super Over rules, writing playing conditions,
  sponsorship for local tournaments, Ramadan night tournaments.
- Publish a short report after every final you host, linking to the
  tournament page.
- Never publish copied or bulk AI-generated text. Google demotes "scaled
  content", and AdSense rejects it.

## Step 5 — Build authority / backlinks (ongoing; the biggest factor)

| Action | Why |
|---|---|
| **Google Business Profile** for MTK Codex (Lahore) | Local results + brand panel |
| Facebook page, Instagram, YouTube (match highlights), LinkedIn, X | Brand signals; send them to me to add as `sameAs` in structured data |
| Every league on the platform links to its public pages from its WhatsApp groups, Facebook page and posters (QR code) | Real users + links |
| Local sports directories, Pakistani startup directories, Product Hunt | Relevant backlinks |
| Cricket forums and Facebook groups: answer questions, link a guide when it truly helps | Referral traffic + links |
| Local news / sports blogs: pitch tournament results and finals | High-authority links |
| Partner with clubs, schools and academies to host their tournaments | Each one links back |

Avoid buying links or link packages. Google penalizes them and recovery takes months.

## Step 6 — Measure monthly

- Search Console: impressions, clicks, average position per query and page.
- Number of indexed pages (should grow with every guide and published tournament).
- Referring domains (Search Console → *Links*).
- Core Web Vitals report: stay "Good" on mobile.

## Monthly checklist

- [ ] 4–8 new guides or match reports published
- [ ] New tournaments published and scored live
- [ ] Search Console errors reviewed and fixed
- [ ] 3+ new genuine backlinks or profile links
- [ ] Top queries reviewed; titles improved for pages ranking 5–20
