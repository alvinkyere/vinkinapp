# ENG8 — Threat Model and Security Decisions

**Date:** 2026-07-28
**Scope:** `docs/architecture/eng-roadmap.md`'s ENG8 ("Security hardening") — required before
any external pilot. This document covers the two items that are decisions/documentation
rather than code (CSRF strategy, the threat model) plus a live status table for every other
ENG8 checklist item, cross-referenced against `milestone-reports/ENG8-SECURITY-HARDENING.md`
for what was actually built this pass.

## CSRF strategy: not applicable, by construction — not by omission

CSRF exploits **ambient, browser-attached credentials** (cookies sent automatically on every
request to a domain, regardless of which site's page triggered the request). This API has no
cookie-based authentication anywhere — confirmed by grep across every route module — every
client (`apps/mobile`, `apps/guest-web`, `apps/operations-console`) authenticates with a
bearer token (`Authorization: Bearer <jwt>` or a guest `vgt_`/operator token) that must be
read from client-side storage and explicitly attached to each request by the calling code. A
malicious third-party page cannot make the victim's browser attach a bearer token it has no
access to; there is no ambient credential for a forged cross-site request to ride on.

This makes CSRF tokens/double-submit-cookie patterns genuinely unnecessary here, not merely
skipped — adding one would defend against an attack this architecture cannot suffer. If a
cookie-based auth mode is ever added (e.g. a first-party web session for the operator
console), CSRF protection becomes required again at that point; this is the actual revisit
trigger, not a scheduled review date.

## Threat model

The roadmap names ten scenarios. Each below states the real, current mitigation (with a
citation) or the honest gap.

| # | Threat | Status | Mitigation / gap |
|---|---|---|---|
| 1 | Invite-link theft | Partial | Guest tokens are hashed at rest, single-vink-scoped opaque secrets (D14, `auth/guest-tokens.ts`) — a stolen link grants access to exactly one vink, nothing else. Gap: no expiration or operator-triggered revocation-on-suspicion exists; a leaked link is valid until the vink itself closes. |
| 2 | Organizer impersonation | Mitigated | Every organizer-only route checks `claims.userId === vink.organizerUserId` server-side (`vinks/routes.ts`); JWT sessions use rotating refresh tokens with family-wide revocation on reuse detection (PV1, ENG5 Slice 2). |
| 3 | Duplicate contribution attempts | Mitigated | Server-derived deterministic idempotency keys (§12, `packages/payment-provider/src/operation-ids.ts`); PostgreSQL uniqueness is the final guard per the hard rule, proven under genuine concurrency (`vinks.integration.test.ts`'s concurrent-open/concurrent-create tests). |
| 4 | Payment replay | Mitigated | Same idempotency-key mechanism as #3, applied to every provider-facing operation (authorize, capture, refund) — a replayed request returns the original committed result, never double-executes. |
| 5 | Malicious merchant simulation | Mitigated | VinkIn decides its own §17 merchant-authorization outcome server-side (MCC checks, first-merchant lock, spend-limit enforcement in `packages/application/src/purchases.ts`) — the simulator/provider's own claimed outcome is never trusted blindly. |
| 6 | WebSocket subscription leakage | Partial, already disclosed | Every snapshot is genuinely scoped to who's asking (guest tokens get `GuestVinkView`, never the organizer's full view — `modules/realtime/routes.ts`). Known, pre-existing, already-documented gap (not new to ENG8): the auth token rides in the WS upgrade URL's query string (`?token=`) because browsers cannot attach an `Authorization` header to a WebSocket handshake — this can land in proxy/access logs. The code's own header comment flags this explicitly ("G4-adjacent... revisit before real money"). Not fixed in this pass: rewiring this needs coordinated client changes in both `apps/mobile` and `apps/guest-web`, a bigger cross-cutting change than ENG8's scope, and the existing disclosure already names the correct revisit trigger. |
| 7 | ID enumeration | Mitigated | Every domain ID is a UUID (`middleware/params.ts`, ENG2 Slice A); the one enumerable-shaped surface (public join codes) deliberately returns a uniform 404 for both "malformed" and "doesn't exist," never leaking which. |
| 8 | Deadline manipulation | Mitigated (as of ENG1) | Deadlines are entirely server-computed and server-enforced (`VINK_OPEN_DURATION_SECONDS`/`VINK_PROCESSING_GRACE_SECONDS`, `apps/api/src/config/env.ts`) — the client cannot set or influence `submissionDeadline` at all (ENG1's "timer semantics" milestone removed the client's ability to send one). The deadline sweep itself runs from PG-owned truth (D5), not client-reported time. |
| 9 | Refund abuse | Partial | Refunds only ever fire from a server-decided trigger (a failed-session sweep, or an operator-triggered retry through the audited ops console) — no route lets any client request an arbitrary refund amount or target. Gap: no explicit rate/velocity limit exists on the operator-triggered retry path specifically; low real risk since it requires the shared operator credential (D17) already gating that whole surface. |
| 10 | Privilege escalation in operations tools | Partial, disclosed since D17 | Every ops/reconciliation route requires a valid operator token (`requireOperator`, shared verbatim between `modules/ops/routes.ts` and `modules/reconciliation/routes.ts`) on top of environment gating. The known weak point, unchanged by ENG8 and already ratified as an accepted risk (D17): one shared operator password, not per-operator accounts — every operator action is attributed to a typed name the operator enters themselves, not a verified identity. D17's own revisit trigger (PV12, multiple operators on rotating shifts) still applies; not re-litigated here. |
| 11 (SH1) | Horizontal privilege escalation via `resolveContributionCommand` | Mitigated | Found and fixed by SH1 (`milestone-reports/SH1-SECURITY-HARDENING.md`): `POST .../contributions/:id/resolve` had no ownership check at all — any authenticated user could resolve, and via RM3A capture-immediately, actually capture money on, any other participant's pending contribution on any vink. Fixed with a `requester` field enforced against the vink's organizer or the contribution's own participant, proven with a regression test confirmed to fail pre-fix and pass post-fix. |
| 12 (SH1) | Unauthenticated `/internal/simulator/*` on the hosted `demo` environment | Mitigated | Found and fixed by SH1: eight dev/test-only utility routes were gated only by an environment allowlist that includes `demo` — the live hosted pilot's own `VINKIN_ENV`, per the ENG4 hosted-activation note — with no bearer auth at all, letting any internet caller manipulate any vink's deadline/resolution/refund state. `MockFinancialProvider` still drives all command execution (`server.ts:26`), so no real money could move through this specific gap, but it was a real, live, unauthenticated cross-tenant state-manipulation hole. Fixed by requiring `requireOperator` on all eight routes. |

## Disclosed gaps carried out of this milestone

- **Data-retention rules and a system-wide privacy review** — explicitly deferred, owner
  choice (see the ENG8 milestone report). No retention/deletion policy or legal requirement
  has been specified anywhere in this project's docs; inventing one from code would be a
  product/legal decision made silently, which this repo's own §9 rule prohibits.
- **`brace-expansion` (GHSA-mh99-v99m-4gvg) — closed by SH1, not carried forward.** ENG8 left
  this deliberately unfixed (a major-version jump its own direct dependent declared
  incompatible). SH1 found a same-major patch release now exists in each affected lineage's
  own declared range (no longer a major jump), fixed both via scoped `pnpm-workspace.yaml`
  overrides, and removed the `ignoreGhsas` entry — `pnpm audit` now reports 0 vulnerabilities
  with no ignore list at all. See `milestone-reports/SH1-SECURITY-HARDENING.md`.
- **Semgrep's actual findings against this codebase were not dry-run locally** — this
  environment's disk was too constrained (repeatedly documented across earlier milestones —
  see ENG1-TIMER-SEMANTICS.md, I6.md) to safely install Semgrep's toolchain for a local
  verification pass. The CI gate is scoped to `--severity ERROR` only for its first run, to
  avoid an unreviewed flood of WARNING/INFO findings blocking every PR before anyone has seen
  what the ruleset actually flags in this codebase.
- **The least-privilege `vinkin_app` database role is code-complete but not provisioned** —
  migration 0023 creates the role and grants it exactly the privileges the running app uses
  (SELECT/INSERT/UPDATE, confirmed via a grep of every non-test query — no DELETE, no DDL
  anywhere in application code). Actually connecting `apps/api` as this role instead of
  today's full-privilege connection needs a real password (`ALTER ROLE vinkin_app
  PASSWORD ...`, never checked into a migration) and a `DATABASE_URL` swap in each deployed
  environment — a credential/deploy-config action, same "code-complete but not provisioned"
  shape as ENG4 Slice 2's Railway topology.
