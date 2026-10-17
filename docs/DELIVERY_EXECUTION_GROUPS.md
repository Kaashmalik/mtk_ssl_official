# Consolidated execution groups

Updated with Batch 85, 17 October 2026. This changes execution organization,
not scope, release gates or the meaning of completion. The authoritative task
IDs remain in `SAAS_MASTER_PLAN_2026-10-12.md`.

## Stop treating open checkboxes as untouched development

There are 79 IDs: 19 checked and 60 open. Many open IDs contain substantial
implemented slices. For example, ISO-06 has the legacy authorization retirement,
SCORE-12 has producer/outbox/consumer source, and SCORE-11 has fencing and now
revision/review source. None of those facts proves deployed acceptance. Review
the latest batch evidence before opening a new implementation task.

`corepack pnpm roadmap:status` inventories the authoritative checklist and
groups every open ID exactly once. `corepack pnpm test:roadmap` checks the
inventory. It does not inspect deployment or automatically close checkboxes.

## Seven delivery groups, not sixty assumed batches

| Group | Open IDs carried | Execution focus |
| --- | --- | --- |
| Release foundation and acceptance | BASE-04..06, REL-01..07 (10) | Configure disposable staging, identities/providers, real database/device/broker tests, retained evidence producer, restore/rollback and owner approval |
| Isolation, membership and authentication | ISO-04..09, IAM-02..09 (14) | Audit delivered slices first; consolidate genuinely missing grants, private boundaries, workspace/cache scoping, invitation retry/idempotency, MFA/recovery and role journeys |
| Match-day scoring and mobile | SCORE-08..14 (7) | Revisions/review/fencing as one vertical feature; then approved mobile identity, remaining cricket/correction rules, private live access and multi-instance recovery |
| Registration and competition | REG-01..07, COMP-03..07 (12) | Complete registration/onboarding, lifecycle/eligibility and competition/dispute/correction workflows together; reuse existing fixture/XI/standings implementations |
| Public records, awards and prizes | PUB-02..06 (5) | Publication-approved career hub, remaining records/privacy and official award/prize/correction flows |
| Role UX and fan engagement | UX-03..04, FAN-01..04 (6) | Complete role/device journeys, moderation, notifications and labelled analytics/AI without changing official scores |
| White-label and commercial | PREM-01..06 (6) | Integrated brand publish/rollback, domain/email, sponsorship and verified entitlement/payment journeys; enterprise scope remains gated by the plan |

These are delivery groups, not a promise that each fits one commit/session or
that the product can be finished immediately. Counts include partly implemented
items and release acceptance. No speculative completion date or zero-bug claim.

## Faster definition of a delivery batch

1. Sync once, select a coherent feature group, and record its remaining
   source work separately from already-built work and external acceptance.
2. Implement schema, canonical writer, read model, action/API and usable UI
   together. Preserve exact-league authorization and existing lock ordering.
3. Run focused checks during development. Reuse fixtures and test adapters;
   do not repeatedly run every service after a small local edit.
4. Run one final full affected-suite/typecheck/release-checker pass. Limit
   heavyweight parallel processes on this Windows host to avoid timeout noise.
5. Record actual results and boundaries, review the diff, commit/push normally.
   Failed acceptance remains open; synthetic tests cannot produce real proof.
6. Move to the next coherent feature without requiring another user prompt,
   unless a decision, external approval or unavailable infrastructure blocks it.

## External critical path

Source work can proceed without staging, but all-complete cannot. Required
inputs are an explicitly authorized disposable database/staging target,
representative authenticated users/devices, provider test integrations,
deployed socket/broker instances and an owner approval channel. Do not use an
unrelated project, execute production migrations implicitly, fabricate evidence
or enable `LEAGUE_MEMBERSHIP_CONTROLS_READY` to make the tracker look finished.

Batch 85's migration remains local-only. Schema application, coordinated old
writer drainage/web-service deployment, real two-session locking/rollback and
browser/mobile/provider/recovery proof are separate acceptance steps.
