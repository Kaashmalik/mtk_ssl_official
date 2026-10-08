# SSL Platform — Deep Audit v2 (Screen-by-Screen UX + Frontend/Backend Sync)

**Date:** 2026-06-24
**Scope:** Every user-facing screen + frontend↔backend wiring across web (26 pages), admin (27 pages), marketing (2), mobile (14 screens).
**Predecessor:** `AUDIT_DEEP_2026-06-23.md` (architecture/data layer). This doc focuses on **user flows, UI/UX, and frontend-backend synchronization.**
**Method:** Read every screen, traced each form/action to its backend target, verified against the live DB.

---

## 0. Executive summary — what changed in this re-audit

The v1 audit found architecture problems. This re-audit walked every screen and
found a **new class of problem that's more urgent for users**: the backend is
real and complete, but **the UI is not wired to it in several critical places.**
Three of the four core "create" forms are **no-ops** (fake delay → redirect,
nothing saved). A user can *see* teams/players/matches but cannot *create* them
through the UI. This is the highest-ROI fix on the platform.

| Layer | Status | Note |
|---|---|---|
| Backend server actions (create/update/delete for all entities) | ✅ **Complete & real** | `createTeam/updateTeam/deleteTeam`, `createPlayer/...`, `createMatch/...`, `createTournament/...` — all implemented, `withAuth` guarded, tenant-scoped |
| UI wiring to those actions | ❌ **3 of 4 create forms broken** | teams/new, players/new, matches/new use `setTimeout` fake delay instead of the real action |
| Edit flows | ❌ **Nonexistent** | Edit buttons link to `/…/edit` routes that **don't exist** (404) |
| Delete flows | ❌ **Nonexistent** | No delete UI anywhere, despite `deleteTeam`/`deletePlayer`/etc. existing |
| Read/list/detail flows | ✅ **Real** | All list + detail pages hit the DB directly, real data |
| Settings / branding | ✅ **Real** | `updateTenantBrandingSettings` + toast feedback |
| Billing flow | ✅ **Real (manual)** | Real subscription-request pipeline, but hardcoded personal bank details |
| Admin console | ✅ **Real** | 22 API routes, all `verifySuperAdmin`-guarded, real DB writes |
| Core scoring (web + mobile) | ❌ **Not persisted** | Confirmed again — confirmed 0 rows in `match_balls` |

---

## 1. 🚨 CRITICAL — The "fake submit" bug (systemic, 3 screens)

This is the most damaging finding for actual users. The forms are beautiful,
show a loading spinner, then redirect to the list page — and **save nothing.**

### 1.1 `apps/web/src/app/dashboard/teams/new/page.tsx`
```ts
const handleSubmit = async (e) => {
  e.preventDefault()
  setIsSubmitting(true)
  try {
    await new Promise(r => setTimeout(r, 1000))   // ← fake delay, NO createTeam()
    router.push("/dashboard/teams")               // ← redirects, nothing saved
  } ...
}
```
**The `createTeam` action exists and works** (`teams.ts:67`) — it's just not called.

### 1.2 `apps/web/src/app/dashboard/players/new/page.tsx`
```ts
// TODO: Replace with createPlayer action when tenant is available
// await createPlayer({ ...formData, tenantId: currentTenantId })
await new Promise(r => setTimeout(r, 1000)) // Simulate API call
```
Even has a TODO comment admitting it. `createPlayer` exists (`players.ts:61`).

### 1.3 `apps/web/src/app/dashboard/matches/new/page.tsx`
Two bugs:
1. Same `setTimeout` fake-submit, no `createMatch()` call (`createMatch` exists at `matches.ts:48`).
2. **Hardcoded demo teams** in the dropdown:
```ts
const teams = [
  { id: "1", name: "Lahore Lions" }, { id: "2", name: "Karachi Kings" },
  { id: "3", name: "Islamabad United" }, ...
]
```
These are PSL franchise names, not the tenant's actual teams. A user would be
"creating" a match between teams that don't exist in their league. This should
fetch `getTeams()` for the tenant.

### 1.4 The fix is small and high-impact
Each form needs ~5 lines changed: import the action, call it with the form data,
handle the result with `toast`. Tournaments proves the pattern works
(`new-tournament-form.tsx:47` already calls `createTournament` correctly). Estimated effort: **1–2 hours for all three.**

---

## 2. 🚨 CRITICAL — No edit or delete flows exist (despite backend support)

The backend has full CRUD:
```
teams.ts:    createTeam ✓  updateTeam ✓  deleteTeam ✓
players.ts:  createPlayer ✓  updatePlayer ✓  deletePlayer ✓
matches.ts:  createMatch ✓  updateMatch ✓  deleteMatch ✓
tournaments.ts: createTournament ✓  updateTournament ✓  deleteTournament ✓
```

But the UI:
- **No `/dashboard/{entity}/[id]/edit` routes exist** for any entity (verified — the dirs aren't there).
- Team detail page (`teams/[id]/page.tsx:125`) has an **Edit button linking to `/dashboard/teams/${id}/edit`** → that route doesn't exist → **404**.
- The **Follow button** (`teams/[id]/page.tsx:123`) has no handler (despite `followEntity` action existing).
- **No delete buttons** anywhere — users cannot remove a wrongly-created team/match.

So a user who fat-fingers a team name can never fix it. This is a real usability
dead-end. The actions are written; the UI just never got built. **Effort: ~1 day to add edit forms + delete-with-confirm for all 4 entities.**

---

## 3. 🚨 CRITICAL — Scoring does not persist (confirmed again, now on mobile too)

(Re-stated from v1 with mobile confirmation.) The scoring flow is broken on
**both** platforms:

**Web** (`app/matches/[matchId]/scoring/page.tsx`): balls → Zustand+localStorage
→ WebSocket → `services/api` `scoring.service.addBall` (STUB, returns fake id).

**Mobile** (`app/scoring/[matchId].tsx`) — **worse**:
- Runs/wickets/overs are stored in **plain `useState`** (lines 18–21), which
  **resets to 0 on every app restart**. Not even persisted to AsyncStorage.
- Balls go into `addPendingBall` (offline queue) → `useOfflineSync` flushes to
  the same stubbed NestJS `localhost:4000` endpoint.
- So a scorer on mobile loses the entire innings if the app is backgrounded.

**Live DB confirms it:** `SELECT count(*) FROM match_balls` → **0**.
This is the platform's headline feature and it has never written a real ball.

---

## 4. 🟡 Performance — N+1 query patterns in 4 screens

The dashboard (`dashboard/page.tsx`) was *correctly* refactored to batch queries
(no N+1). But 4 other screens still use the old per-row loop pattern:

| Screen | Pattern | Cost |
|---|---|---|
| `teams/page.tsx:22-39` | per-team: 3 count queries (players, wins, losses) | 3N queries |
| `teams/[id]/page.tsx:42-74` | per-match: opponent name query + innings query | 2N queries |
| `dashboard/scoring/page.tsx:48-59` | per-match: 2 team-name queries | 2N queries |
| `dashboard/page.tsx` recent/live/upcoming | **(already fixed — batched)** | good ✓ |

For a league with 16 teams and 50 matches, `teams/[id]` runs ~100 queries on
one page load. Fix by batching with `inArray` (the pattern is already
demonstrated in `dashboard/page.tsx:59-77`). **Effort: ~2 hours.**

---

## 5. 🟡 Data drift — pricing/plans duplicated in 4 places

Plan definitions (name, price, limits, features) are copy-pasted in **4 files**:
1. `packages/database/src/lib/plan-limits.ts` — `PLAN_PRICES`, `PLAN_LIMITS`
2. `apps/web/src/app/api/subscriptions/request/route.ts` — `PLAN_PRICES`
3. `apps/marketing/src/components/pricing.tsx` — literal strings
4. `apps/web/src/app/dashboard/settings/billing/billing-client.tsx:18-101` — `PLANS` const (the biggest copy, ~85 lines)

Any price change requires editing all 4 or they drift (and they already differ
slightly in feature lists). **Fix:** make `plan-limits.ts` the single source;
export a `PLANS` array; import it in marketing + billing. **Effort: ~1 hour.**

### 5.1 Hardcoded personal bank details
`billing-client.tsx:298-417` hardcodes a **personal** bank account (Meezan,
"MUHAMMAD KASHIF", IBAN `PK26MEZN…`, phone `0302 071 8182`) and JazzCash/EasyPaisa/Raast
on the same personal number. This is in version control and shipped to every tenant.
Should be a DB/env config (`payment_accounts` table or `PAYMENT_*` env vars) so
it can change without a redeploy and isn't a single person's account.

---

## 6. Screen-by-screen status matrix

Legend: ✅ real · ⚠️ minor issue · ❌ broken

### 6.1 Web app (`apps/web/src/app`)
| Screen | Status | Notes |
|---|---|---|
| `/` landing | ✅ | |
| `/dashboard` | ✅ | Batched queries, great empty states, live banner |
| `/dashboard/tournaments` list | ✅ | |
| `/dashboard/tournaments/new` | ✅ | Calls `createTournament` (the reference implementation) |
| `/dashboard/tournaments/[id]` | ✅ | |
| `/dashboard/teams` list | ⚠️ | N+1 (3 queries/team) |
| `/dashboard/teams/new` | ❌ | **Fake submit — no save** |
| `/dashboard/teams/[id]` | ⚠️ | N+1; Edit button → 404; Follow button no-op |
| `/dashboard/players` list | ✅ | |
| `/dashboard/players/new` | ❌ | **Fake submit — no save** |
| `/dashboard/players/[id]` | ✅ | |
| `/dashboard/matches` list | ✅ | |
| `/dashboard/matches/new` | ❌ | **Fake submit + hardcoded demo teams** |
| `/dashboard/matches/[id]` | ✅ | |
| `/dashboard/matches/live/[id]` | ❌ | Uses deprecated `use-match-data` (localhost:4000, deleted service) |
| `/dashboard/scoring` | ⚠️ | N+1; lists real matches but links to broken scoring page |
| `/matches/[matchId]/scoring` | ❌ | **Core feature — balls never persist** |
| `/dashboard/registrations` | ✅ | Real DB |
| `/dashboard/users` | ✅ | |
| `/dashboard/stats` | ✅ | Real DB |
| `/dashboard/settings` | ✅ | Real `updateTenantBrandingSettings` |
| `/dashboard/settings/billing` | ✅ | Real; but hardcoded bank details (§5.1) |
| `/dashboard/league/setup` | ✅ | `createTenant` |
| `/settings/branding` | ✅ | |
| error.tsx coverage | ✅ | 10 error boundaries across dashboard routes |
| loading.tsx coverage | ⚠️ | Only 6 loading.tsx (some routes use Suspense inline) |
| not-found.tsx | ❌ | **None** — 404s render the default Next page |

### 6.2 Admin app (`apps/admin/src/app`) — 27 screens
| Area | Status | Notes |
|---|---|---|
| Dashboard overview | ✅ | Fetches `/api/revenue` + `/api/system-health`, auto-refresh |
| Tenants (list/new/[id]) | ✅ | Real CRUD via API routes |
| Users | ✅ | |
| Players / Teams / Tournaments / Venues (list + new) | ✅ | |
| Matches (list + new) | ✅ | |
| Payments | ✅ | Real approve/reject via PATCH `/api/subscriptions` |
| Revenue | ✅ | |
| Commission | ✅ | `commission_rates` table |
| Live Scoring | ✅ | Polls `/api/matches?status=live` every 5s |
| Commentary (+ AI) | ✅ | Real insert + AI generation route |
| Feature Flags | ✅ | |
| Announcements | ✅ | |
| Waitlist | ✅ | |
| White-label | ✅ | |
| System Health | ✅ | |
| Impersonation | ✅ | Signed token + audit ledger (fixed in v1) |
| **API route auth** | ✅ | 20/22 `verifySuperAdmin`; the other 2 are `/health` (intentional) + `/impersonate/verify` (token IS the auth) |

**Admin is the most production-complete app.** The only gap is the super-admin
**email-match bypass** still in `admin-auth.ts:26` (carried from v1).

### 6.3 Marketing (`apps/marketing/src/app`) — 2 screens
| Screen | Status | Notes |
|---|---|---|
| Landing | ✅ | |
| Waitlist API | ✅ | Real `waitlist` insert |

### 6.4 Mobile (`apps/mobile/app`) — 14 screens
| Screen | Status | Notes |
|---|---|---|
| Tabs (index/matches/standings/settings) | ✅ | |
| team/[teamId], player/[playerId] | ✅ | |
| match/[matchId], results, news, teams, players | ✅ | |
| **scoring/[matchId]** | ❌ | **`useState` only — resets on restart; syncs to stubbed service** |
| Auth | ⚠️ | Uses Supabase Auth while web uses Clerk (dual-identity, v1) |
| Push notifications | ⚠️ | Registers to `localhost:4000` (dead service) |

---

## 7. 🟡 UI/UX & accessibility findings

### 7.1 Accessibility
- **Only 1 of 32 shared UI components** has ARIA attributes. Form fields are
  okay (use `<Label htmlFor>`), but **interactive cards, icon-only buttons, and
  the scoring buttons lack `aria-label`** — screen-reader users can't operate them.
- **Mobile uses 44 inline low-contrast gray colors** (`#9ca3af`, `#6b7280`, `#d1d5db`)
  — several fail WCAG AA on white backgrounds, and they bypass any theme.
- No `not-found.tsx` anywhere → 404s show the bare Next.js default.
- No visible focus styles verified on custom controls (cards as links).

### 7.2 UX consistency
- **Excellent where it exists:** dashboard uses `MotionWrapper`, `StatCard`,
  glass panels, animated live indicators, and consistent empty states with
  helpful CTAs. This is genuinely good design.
- **Inconsistent between apps:** web uses a tokenized theme (`text-muted-foreground`,
  `bg-card`); mobile uses raw hex (`#16a34a`, `#111827`). No shared mobile theme.
- **Loading states:** web mixes `loading.tsx` (6) with inline `<Suspense>` skeletons.
  Fine, but should standardize per-route.
- **Error recovery:** 10 `error.tsx` boundaries exist (good), but they need a
  "retry" action beyond the default reload.
- **Scoring page render bug (v1 §4.8):** `useScoringStore.getState()` called
  during render won't re-render on store change — must use the hook selector.

### 7.3 Frontend ↔ Backend sync issues (the "sync" ask)
| Frontend calls | Backend reality | Gap |
|---|---|---|
| `teams/new`, `players/new`, `matches/new` forms | `createTeam/Player/Match` actions exist | **Forms don't call them** (§1) |
| Edit buttons → `/…/edit` | `updateTeam/Player/Match` actions exist | **No edit pages** (§2) |
| Web scoring → WS `services/api` | `scoring.service.addBall` stubbed | **No persistence** (§3) |
| Mobile scoring → `useOfflineSync` | posts to `localhost:4000` (deleted svc) | **No persistence** (§3) |
| `use-match-data.ts` hooks | call `localhost:4000/api/matches/*` | **Deleted backend** — still imported by 3 files |
| Mobile push register | `localhost:4000/notifications/register` | **Dead endpoint** |
| Billing `PLANS` const | `plan-limits.ts` canonical | **4 copies drift** (§5) |

The pattern: **the backend was built further than the frontend wiring.** Closing
this gap is mostly mechanical (call existing actions from existing forms).

---

## 8. Updated, prioritized recommendation plan

Sequenced by **user impact × low effort first.**

### Sprint 1 — "Make the buttons work" (1–2 days, highest ROI)
1. **Wire the 3 create forms to their actions** (§1): `teams/new`, `players/new`,
   `matches/new` → call `createTeam/Player/Match` + `toast`. Copy the exact
   pattern from `new-tournament-form.tsx:41-58`.
2. **Fix `matches/new` team dropdown** to `getTeams()` instead of hardcoded PSL names.
3. **Delete or replace `use-match-data.ts`** — it calls a dead backend and is
   imported by the scoring page, live page, and player-selector. Migrate those
   3 call sites to server actions (`getMatch`, etc.).
4. **Add `not-found.tsx`** at app root + key routes.

### Sprint 2 — "Complete CRUD" (2–3 days)
5. **Build edit pages** for teams/players/matches/tournaments using the existing
   `update*` actions (4 small forms, reuse the create form as a template).
6. **Add delete-with-confirm dialogs** to detail pages using `delete*` actions.
7. **Wire the Follow button** on team detail to `followEntity`.
8. **Fix the 4 N+1 query screens** (§4) with batched `inArray` lookups.

### Sprint 3 — "Make scoring real" (3–5 days, the big one)
9. **Implement `ScoringService` persistence** in `services/api`: `addBall` →
   `db.insert(matchBalls)`, `getMatchState` → aggregate from `match_balls`.
10. **Fix WS namespace** (`/scoring` client vs `/` gateway).
11. **Add a `saveBall` server action** as offline-sync target so scoring works
    without the WS service (mobile `useOfflineSync` and web `pendingSync` both
    post here).
12. **Mobile:** move runs/wickets/overs out of `useState` into `AsyncStorage`
    (or the match store) so they survive restart; hydrate from `match_balls` on open.
13. **Web scoring page:** use the store selector (not `getState()` in render),
    pull `teamId`/`totalOvers` from match data, hydrate innings from DB.
14. **E2E test:** score 6 balls → reload → assert persisted (Playwright spec exists).

### Sprint 4 — "Data integrity & polish" (2 days)
15. **Reconcile migration drift** (v1 §3.2) — apply missing migrations, CI gate.
16. **Single-source pricing** (§5): one `PLANS` export, imported everywhere.
17. **Move bank details to env/DB** (§5.1).
18. **Accessibility pass:** `aria-label` on icon buttons/scoring controls,
    mobile theme tokens replacing the 44 hardcoded grays, focus-visible styles.
19. **Remove admin email-match bypass** (v1 §3.7).

### Sprint 5 — "Strategic" (carried from v1)
20. Decide one backend (gateway vs direct-DB) + one auth (Clerk vs Supabase).
21. Wire a real payment gateway if scaling beyond manual approval.

---

## 9. TL;DR for the owner

**Good news first:** the backend is more complete than I thought — full CRUD
actions exist for every entity, the admin console is genuinely production-ready
(27 screens, all real, all auth-guarded), the billing pipeline works, and the
dashboard UX is polished.

**The problem is wiring, not engineering.** Three create forms fake their
submits, no edit/delete UI exists, and scoring doesn't persist — but in every
case **the backend function to fix it already exists.** The work is mostly
"connect button to existing action."

If you do only three things this week:
1. **Wire the 3 create forms** (Sprint 1) — turns the app from "demo" to "usable."
2. **Add edit/delete** (Sprint 2) — removes the dead-ends.
3. **Make scoring persist** (Sprint 3) — makes the core feature real.

That sequence takes ~1–2 weeks of focused work and converts the platform from
"looks complete but breaks when you use it" into "actually works end-to-end."
