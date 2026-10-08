# SSL Phase 1 Baseline Report + Full Fix Plan

**Date:** 2026-09-23  
**Repo:** https://github.com/Kaashmalik/mtk-ssl2026.git  
**Scope:** web · admin · database · Nest services (hybrid)  
**Rule:** Findings recorded before fixes. Doc-truth already committed as `40c2df0`.

Interactive view: open canvas `ssl-phase1-fix-plan` beside chat.

---

## Locked product decisions

| # | Decision |
|---|----------|
| 1 | Nest `scoring-service` = scoring SoT; web actions → thin proxy |
| 2 | Hybrid backend **Accepted** (Next CRUD + Nest specialists) |
| 3 | Not publicly deployed; intended domain `ssl.mtkcodex.site` |
| 4 | Cloudinary for media; Supabase Storage for payment proofs |
| 5 | PK payments: **manual now**, online JazzCash/EasyPaisa later |
| 6 | Fantasy = pre-MVP; AI commentary + streaming = **beta** |
| 8 | `archive/services` untouched until you say otherwise |

---

## Phase 1 verification results

| Target | Typecheck | Lint | Build |
|--------|-----------|------|-------|
| `@mtk/database` | Pass | Pass | Pass |
| `@mtk/admin` | Pass | **Fail** | **Pass** |
| `@mtk/web` | Pass | **Fail** | **Fail** |
| Nest ×10 | N/A (only `api` has script) | Untested | **Pass** |

### Web build failure (CRIT)
Compile succeeds; prerender of `/dashboard/matches` throws:
`@clerk/nextjs: Missing publishableKey` — build env missing `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.

---

## Severity-ranked findings

| Sev | ID | Finding | Evidence |
|-----|-----|---------|----------|
| CRIT | P1-01 | Web production build blocked by Clerk key at prerender | Build log `/dashboard/matches` |
| HIGH | P1-02 | Cloudinary env vars used, missing from `.env.example` | `cloudinary-upload.tsx` |
| HIGH | P1-03 | ESLint `require()` forbidden in `next.config.js` | web L1/L58; admin L126 |
| HIGH | P1-04 | Scoring dual-write vs Accepted SoT | `actions/scoring.ts` + scoring-service |
| HIGH | P1-05 | Mobile offline → anon `match_balls` (broken + wrong shape) | `use-offline-sync.ts` |
| MED | P1-06 | 9/10 Nest pkgs lack `type-check` | package.json |
| MED | P1-07 | Nest lint uses `--fix` | weak CI |
| MED | P1-08 | Env secrets often optional at boot | `env.ts` schemas |
| LOW | P1-09 | Sentry sourcemap noise on every next build | Sentry SDK warning |
| SEC | P2-01 | Live `has_table_privilege` for anon on sensitive tables | Phase 2 |

---

## Fix plan — fully functional & professional

### Wave A — Unblock (first)
1. **P1-01** Fix web build: Clerk keys in CI/build env **or** `force-dynamic` / no-prerender on Clerk dashboard routes  
2. **P1-02** Document `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` + `UPLOAD_PRESET` in `.env.example`  
3. **P1-03** Fix next.config lint (ESM or scoped eslint exception)  
4. **P1-06/07** Add Nest `type-check`; drop `--fix` from lint for CI  
5. Re-verify `pnpm --filter @mtk/web build` + admin + scoring-service  

**Commits (one each):**  
`fix(web): unblock Clerk prerender` → `docs(env): Cloudinary` → `chore(lint): next.config` → `chore(services): type-check + lint CI`

### Wave B — Functional core
1. Thin-proxy web scoring → scoring-service; remove dual ball persistence  
2. Wire web Socket.IO client (reconnect/backoff) to scoring gateway  
3. Mobile offline → scoring-service with `client_op_id` / `ball_sequence` (023)  
4. Keep manual payments shipping; gate online providers until merchant live  
5. Ensure fantasy stays roadmap-only in UI/marketing  

### Wave C — Security (professional SaaS)
1. Live grant check + `REVOKE` on `user_tenant_roles` / `impersonation_sessions`  
2. RLS or explicit deny for PostgREST on those tables  
3. Audit `withTenantContext` on all mutating actions  
4. Harden payment-proof upload paths  

### Wave D — Beta → solid
1. AI commentary: full circuit-breaker coverage; Beta badge in UI  
2. Streaming: gateway auth + room lifecycle e2e  
3. Sentry complete on web/admin/Nest; staging vs prod env split  

### Wave E — Premium polish (after A–D)
1. Design-token consistency  
2. Loading/empty/error on dashboard, scoring, billing  
3. Mobile responsive scoring + registration  
4. CI: lint + typecheck + build + critical e2e on every PR  
5. DNS go-live for `ssl.mtkcodex.site` per `live.md`  

---

## Recommended next action

Wave A–D complete on `main`. Next: **Wave E** (design tokens, empty/error states, mobile scoring, CI gates, DNS go-live).
