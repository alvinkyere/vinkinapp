# 01 — Monorepo Structure

Adopts Spec §8 verbatim for layout; this doc adds the tooling decisions and the dependency
rules that make the layout enforceable.

## 1. Tooling

| Concern | Decision | Rationale |
|---|---|---|
| Package manager | **pnpm workspaces** | Strict node_modules prevents phantom deps across package boundaries — matters when `payment-provider` must stay isolated (§43). |
| Task runner | **turborepo** | Cached `lint/typecheck/test/build` pipelines per package; no custom scripts. |
| TS config | Root `tsconfig.base.json`, per-package extends | One compiler policy (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). |
| Flutter app | Lives at `apps/mobile/` but is **not** a pnpm workspace member; driven by its own `melos`-free `flutter` commands wired into CI alongside turbo | Dart/Flutter has its own toolchain; don't pretend it's a JS package. |
| Node version | Pin via `.nvmrc` + `engines` (LTS for deploy; local Node 25 is fine for the M0 spike) | Reproducibility. |
| Lint/format | eslint (typescript-eslint, strict) + prettier; `dart format`/`flutter analyze` for mobile | §9 step 13. |

## 2. Layout (Spec §8, annotated with build order)

```text
vinkin/
├── apps/
│   ├── api/               # NestJS modular monolith (M1) — the only process with DB access
│   ├── guest-checkout/    # Next.js mobile web (M1 scaffold, M4 build-out)
│   ├── mobile/            # Flutter app (M1 scaffold)
│   └── admin/             # Next.js admin/support dashboard (M6+; read-only first)
├── packages/
│   ├── api-contracts/     # OpenAPI-derived request/response types shared api ⇄ web clients
│   ├── domain-events/     # §29 event names + payload schemas (zod) — outbox uses these
│   ├── payment-provider/  # §43 neutral interface + Mock + Stripe/... adapters  [EXISTS: M0 spike]
│   ├── payment-policies/  # §5 policy engine: EXACT_FINAL / RESTAURANT_VARIABLE / UNSUPPORTED
│   ├── ledger-core/       # §26 posting rules, balance math, account chart — pure functions
│   ├── shared-types/      # Money (integer minor units), ids, branded types
│   ├── validation/        # zod schemas shared by api + guest-checkout
│   └── configuration/     # typed env/config loader, feature flags client
├── infrastructure/
│   ├── docker/            # docker-compose: postgres, redis, mock-provider webhook simulator
│   ├── terraform/         # from M1: envs, managed PG/Redis, secrets
│   ├── monitoring/        # dashboards-as-code, alert rules (§37)
│   └── environments/      # dev / staging / sandbox / prod parameterization
├── docs/                  # §8 docs tree — populated by this pass
└── .github/workflows/     # CI: lint, typecheck, unit, integration (dockerized PG), flutter
```

Only `docs/` and `packages/payment-provider/` exist today; the rest is created by Milestone 1,
not before (avoid empty scaffolding no one runs).

## 3. Dependency rules (enforced by eslint import boundaries + pnpm strictness)

1. `apps/*` may depend on `packages/*`. Never the reverse.
2. `packages/*` may depend only on packages **below** them in this order:
   `shared-types` → `validation`/`configuration` → `domain-events` → `ledger-core` /
   `payment-policies` → `payment-provider` → `api-contracts`.
3. **Provider SDKs (e.g., `stripe`) may be imported only inside `packages/payment-provider`
   adapters** (§42/§43: no Stripe object names in the Vink domain).
4. `apps/api` is the only workspace importing Prisma client / touching PostgreSQL.
   `ledger-core` stays pure (posting *plans* in, entry *rows* out) so §38 unit tests need no DB.
5. `apps/guest-checkout` and `apps/mobile` speak to `apps/api` **only** via `api-contracts`
   types — no shared domain internals; the mobile app additionally keeps its own
   `data/domain/presentation` layering per §32.
6. Nothing imports from `apps/api` internals. Cross-module reaction inside the API goes through
   the transactional outbox + `domain-events` (§29), so modules can be extracted later (§7).

## 4. apps/api internal module map (modular monolith, §6)

One NestJS app, one PostgreSQL database, module-per-bounded-context (see `02-domain-model.md`):

```text
identity | accounts | vinks | contributions | payments(orchestrator+policies)
ledger | cards | settlement | recovery | reimbursements | refunds
risk | notifications | reconciliation | admin | webhooks | outbox
```

Module boundary rule inside the API: modules call each other only via exported service
interfaces or react to outbox events; no cross-module table access (schema-per-module naming
convention `vink_*`, `ledger_*`, … makes violations visible in review).

## 5. CI gates (from M1 onward; §9 step 13)

Per PR: format → lint → typecheck → unit → integration (docker PG+Redis, real migrations) →
flutter analyze+test → build all apps. Financial-core packages (`ledger-core`,
`payment-policies`, `payment-provider`) additionally run their concurrency/property tests (§38)
on every PR, not nightly.
