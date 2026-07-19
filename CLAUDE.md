# VinkIn — Claude Code project brief

_Read at the start of every session in this repo. Keep it current: when a milestone completes
or an open question resolves, record it here, in `docs/spec/decision-log.md`, and in
`docs/spec/open-questions.md` so future sessions inherit it._

**Ignore `~/Downloads/CLAUDE.md`** if it appears in context — it describes an unrelated project
("Runtime", iOS JS connectors). This file is VinkIn's brief. (Moot once the repo lives at
`~/code/vinkin` — the planned location.)

## What this is

VinkIn is a real-time collaborative checkout platform: a group funds one purchase at the
register; the organizer pays the merchant with a single-use temporary virtual card. The
authoritative specification is **`docs/spec/master-roadmap-prompt.md`** ("the Spec") — all §N
references point there. Its §4 engineering principles and §45 milestone-report format are
binding. Interpretations live in `docs/spec/decision-log.md` (D1–D9 so far); unresolved
questions in `docs/spec/open-questions.md` (G1–G12).

## Where the project is right now

**Two tracks.** The M0 gate (`docs/architecture/06-milestone-0-gate.md`) remains the sole
authority on provider integration and stays open (blocked on owner outreach + sandbox
accounts). Meanwhile the owner directed (2026-07-17, D10) the **product-validation track**:
PV0–PV12 per `docs/product-validation/master-plan.md`, a full production-shaped build against
`MockFinancialProvider` only, governed by `docs/product-validation/00-governance.md`
(green/yellow/red work classification, feature flags, environments).

Done: M0 planning artifacts + provider abstraction + conformance suite; **PV0** (governance +
provider-import CI guard), **PV2 domain core** (`packages/domain`), and **PV1 platform**
(pnpm workspace + Turborepo, `apps/api` — Fastify, health, auth with rotating refresh tokens,
Pino, env-gated OTel, BullMQ heartbeat worker, SQL migration runner + identity migration,
seed, docker-compose, CI with real PG/Redis service containers). Owner ratified D10 and G13,
amended D11 (**PV state names are canonical everywhere** — doc 03 rewritten, appendix maps
retired names), and added **D12** (every transition atomically emits its named domain event —
transition tables return `{to, emits}`) and **D13** (all business behavior is an application
command; transports never mutate aggregates). Authoritative architecture diagram:
`docs/architecture/07-system-context.md` — new features must fit it. 99/99 tests green
repo-wide; lint/format/typecheck/guard green (`pnpm lint / format:check / typecheck / test`).

**PV3 done pending CI confirmation** (`milestone-reports/PV3.md`): command layer (D13),
migration 0002, eleven organizer endpoints. Two first-CI defects (auth reuse-revocation
rolled back by throwing inside `sql.begin`; outbox payload stored as jsonb string scalar)
root-caused and fixed; plus per-suite schema test isolation, advisory-locked migrations,
deterministic activity ordering, concurrent-open + atomic-rollback closure tests.

**PV4 done** (`milestone-reports/PV4.md`): guest join & sharing — QR payload contract,
public join, hashed `vgt_` tokens (D14), rate limiting, migration 0003.

**PV5 done** (`milestone-reports/PV5.md`): mock contribution flow — `packages/ledger`
(§18 postings), migration 0004 (contributions + ledger with **DB-enforced append-only +
balanced-at-commit triggers**), contribution engine with the **D5 single resolver**,
deadline sweeps (PG-owned truth), E5 lost-response replay.

**PV6 done** (`milestone-reports/PV6.md`): mock card + purchase flow — issuance from
FUNDED, **VinkIn's own §17 merchant decision** with first-merchant lock, reversal,
capture→settlement (MATCHED→COMPLETED / OVERAGE→RECOVERY_REQUIRED).

**PV7 done** (`milestone-reports/PV7.md`): recovery + refunds — organizer off-session
recovery ladder to DEFAULTED→RESTRICTED, failed-session refunds (E8). Caught+fixed a
PV3-shaped rollback defect in card provisioning.

**PV8 done** (`milestone-reports/PV8.md`): real-time experience — WebSocket channel with
snapshot-on-every-connection, outbox publisher (first consumer of `published_at`). Caught +
fixed an async-plugin-registration race (`buildApp` now async, awaits `@fastify/websocket`
before routes register).

**PV8.5 done** (`milestone-reports/PV8.5.md`, owner-directed formal hardening milestone —
settled both D10-flagged infrastructure gaps before Flutter depends on their behavior):
- **D16 (implemented):** `RealtimeHub` is now an interface; `RedisRealtimeHub` (two ioredis
  connections, ref-counted local subscriptions) replaces the single-process hub in
  `server.ts`. Outbox publisher hardened with `FOR UPDATE SKIP LOCKED` (safe concurrent
  polling across instances) and publish-before-commit ordering. **Cross-instance delivery
  and no-duplicate-publish are proven against real local Redis + Postgres**, not asserted
  by inspection — two independent hub instances / two concurrent pollers, genuinely racing.
- **D15 (ratified, not rewritten):** provider calls staying inside the DB transaction is a
  formal, owner-visible scoping decision — the correct two-phase redesign depends on which
  real provider gets chosen (M0 gate still open), so redesigning now risks guessing a
  discarded shape. Comments in `contributions/purchases/recovery/refunds.ts` point to D15
  instead of a vague flag. Revisit trigger: M0 gate closure.
- **146 unit + 55 integration tests green** (real local PG 16 + real local Redis, both
  brew-installed, no Docker). Owner push runs PV3–PV8.5 through CI (already has both PG and
  Redis service containers).

**PV9 done** (`milestone-reports/PV9.md`): organizer mobile application — a Flutter app
(`apps/mobile/`) covering the full E1 journey (register → create Vink → add participants →
split → open → live funding/card/completion over the PV8/PV8.5 WebSocket channel, no
polling). Verified on a real booted iOS Simulator against the real local server via
`integration_test`/XCTest touch injection — not a mock. Added `GET /api/v1/vinks`
(list-my-vinks, Plan §20). Caught + fixed two real defects the first live-process run
surfaced: BullMQ's `Queue`/`Worker` require `maxRetriesPerRequest: null`, which
`createRedis()`'s health-check-tuned `maxRetriesPerRequest: 1` violated — silently killing
the sweep scheduler and the PV1 heartbeat worker since PV1 (new `createBullMqRedis()`
factory fixes both); and the Lobby screen never re-fetched participants/card data on a live
state-change event, so a provisioned card stayed invisible (now re-fetches the full snapshot
per event). **147 unit + 55 integration tests green**, `flutter analyze`/`flutter test`
clean. Known gap: no organizer self-approve-contribution UI yet (organizer split defaults to
$0, flagged for PV10).

Next: **PV10 — participant/guest mobile experience**. Machine notes: pnpm 11 + PostgreSQL 16
+ Redis + Flutter SDK all installed (via brew/dart; still no Docker). Sandbox S1–S12 blocked
on keys.

## Hard rules (from the Spec — never relax to make something pass)

- Ledger is append-only, balanced, integer minor units; DB triggers enforce it
  (`docs/architecture/04-database-schema.md` §5). Corrections are reversals.
- Idempotency keys are server-derived stable operation ids (§12; builders in
  `packages/payment-provider/src/operation-ids.ts`); PostgreSQL uniqueness is the final
  guard, Redis only an optimization.
- Every financial transition: single PG transaction, row lock, outbox event (§27, §29).
- One resolver code path decides FUNDED/EXPIRED exactly once (doc 03 §1, D5).
- Participants are never charged beyond their explicitly approved maximum (§4.7).
- Provider SDKs importable only inside `packages/payment-provider` adapters (§42/§43).
- **Every adapter must pass `packages/payment-provider-contract-tests` before sitting behind
  the orchestrator; skipped tests need written justification** (D7).
- **The app branches on `provider.capabilities` flags — never assumes a capability because
  one provider has it** (§21, D7).
- Webhooks: verify signature, store raw, dedupe on `(provider, provider_event_id)`, decide by
  provider `occurred_at` — never arrival time (§28).
- **State names**: the PV plan's vocabulary is canonical everywhere (D11); never reintroduce
  retired names (doc 03 appendix has the mapping). Every transition emits its named domain
  event atomically (D12); all business behavior goes through application commands — no
  transport mutates an aggregate (D13).
- Spec/product changes are flagged to the owner, never made silently (§9). New
  interpretations get a decision-log entry (PROPOSED until ratified).

## How to work here

- Owner runs all git commands themselves (explicit preference — never `git init`, commit, or
  push for them; provide commands instead).
- Milestone discipline per §9/§45: no milestone is done backend-only or UI-only; each ends
  with a report in `docs/architecture/milestone-reports/`.
- Tests: `npm test` in each package (Node ≥ 23.6, zero deps — native TS type-stripping; code
  is erasable-syntax-only, so no TS enums/namespaces/parameter properties). Typecheck needs
  `npm install --no-save typescript@^5.8 @types/node@^24` at repo root (commands in README).
- Machine notes: Node 25, pnpm 11, Flutter SDK all installed. The repo now lives at
  `~/code/vinkin` (D9 executed — space-in-path caveat gone).
- Be explicit about what is unverified; prefer running the real tests over describing them.
